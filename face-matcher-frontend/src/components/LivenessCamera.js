import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Camera } from '@mediapipe/camera_utils';
import { FaceMesh } from '@mediapipe/face_mesh';

import { faceMatcherAPI } from '../services/api';

// Suppress WebGL warnings
const originalWarn = console.warn;
console.warn = function (...args) {
  const msg = args[0]?.toString() || '';
  if (msg.includes('WebGL') && msg.includes('texImage2D')) {
    return;
  }
  originalWarn.apply(console, args);
};

const LivenessCamera = ({ setLiveImage, onCaptureComplete }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraRef = useRef(null);
  const faceMeshRef = useRef(null);
  const processingEnabledRef = useRef(true);
  const sendInProgressRef = useRef(false);
  const faceMeshClosingRef = useRef(false);

  const [capturedImage, setCapturedImage] = useState(null);
  const [isCaptured, setIsCaptured] = useState(false);
  const [borderColor, setBorderColor] = useState('red');
  const [livenessStatus, setLivenessStatus] = useState('Checking...');
  const [isVerifying, setIsVerifying] = useState(false);

  const livenessCheckDoneRef = useRef(false);
  const blinkStartedRef = useRef(false);
  const verifyingRef = useRef(false);
  const livenessVerifiedRef = useRef(false);

  // Liveness detection state
  const faceHistoryRef = useRef([]);
  const textureHistoryRef = useRef([]);
  const earHistoryRef = useRef([]);
  const MAX_HISTORY = 15;

  /** EAR calculation */
  const getEAR = useCallback((pts) => {
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const vertical1 = dist(pts[1], pts[5]);
    const vertical2 = dist(pts[2], pts[4]);
    const horizontal = dist(pts[0], pts[3]);
    return (vertical1 + vertical2) / (2 * horizontal);
  }, []);

  /** Get frame luminance */
  const getFrameLuminance = useCallback((video) => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 100, 100);
    const imageData = ctx.getImageData(0, 0, 100, 100);
    const data = imageData.data;

    let luminance = 0;
    for (let i = 0; i < data.length; i += 4) {
      luminance += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return luminance / (100 * 100 * 255);
  }, []);

  /** Check motion detection */
  const isMotionDetected = useCallback(() => {
    const history = faceHistoryRef.current;
    if (history.length < 5) return false;

    let totalMovement = 0;
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];
      const dx = curr.centerX - prev.centerX;
      const dy = curr.centerY - prev.centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      totalMovement += distance;
    }

    const avgMovement = totalMovement / (history.length - 1);
    return avgMovement > 3;
  }, []);

  /** Check texture change */
  const isTextureChangeDetected = useCallback(() => {
    const history = textureHistoryRef.current;
    if (history.length < 5) return false;

    let maxVariation = 0;
    for (let i = 1; i < history.length; i++) {
      const variation = Math.abs(history[i] - history[i - 1]);
      maxVariation = Math.max(maxVariation, variation);
    }

    return maxVariation > 0.01;
  }, []);

  /** Stop camera */
  const stopCamera = useCallback(async () => {
    processingEnabledRef.current = false;
    faceMeshClosingRef.current = true;
    const video = videoRef.current;

    try {
      if (cameraRef.current && typeof cameraRef.current.stop === 'function') {
        try {
          cameraRef.current.stop();
        } catch (e) {
          console.warn('[LivenessCamera] Error stopping Camera', e);
        }
        cameraRef.current = null;
      }
    } catch (e) {
      console.warn('[LivenessCamera] Error stopping Camera outer', e);
    }

    if (video && video.srcObject) {
      try {
        video.srcObject.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      } catch (e) {
        console.warn('[LivenessCamera] Error stopping video tracks', e);
      }
    }

    try {
      const start = Date.now();
      while (sendInProgressRef.current && Date.now() - start < 700) {
        await new Promise((r) => setTimeout(r, 50));
      }

      faceMeshClosingRef.current = true;

      if (cameraRef.current && typeof cameraRef.current.stop === 'function') {
        try {
          cameraRef.current.stop();
          await new Promise((r) => setTimeout(r, 50));
        } catch (e) {
          console.warn('[LivenessCamera] Error stopping Camera during shutdown', e);
        }
        cameraRef.current = null;
      }

      if (faceMeshRef.current && typeof faceMeshRef.current.close === 'function') {
        try {
          faceMeshRef.current.close();
        } catch (e) {
          console.warn('[LivenessCamera] faceMesh.close() error', e);
        }
      }
      faceMeshRef.current = null;
      faceMeshClosingRef.current = false;
    } catch (e) {
      console.warn('[LivenessCamera] Error closing faceMesh', e);
      faceMeshClosingRef.current = false;
    }
  }, []);

  /** Capture and verify liveness */
  const captureAndVerifyLiveness = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    try {
      if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
        console.warn('[LivenessCamera] Video not ready for capture');
        setLivenessStatus('Camera not ready. Please wait...');
        setIsVerifying(false);
        verifyingRef.current = false;
        return;
      }

      const size = Math.min(video.videoWidth, video.videoHeight);
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas context not available');
      }
      const sx = (video.videoWidth - size) / 2;
      const sy = (video.videoHeight - size) / 2;

      try {
        ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
      } catch (drawErr) {
        console.warn('[LivenessCamera] Canvas draw error:', drawErr);
        setLivenessStatus('Camera issue. Please refresh.');
        setIsVerifying(false);
        verifyingRef.current = false;
        return;
      }

      const dataUrl = canvas.toDataURL('image/jpeg');
      const blob = await (await fetch(dataUrl)).blob();

      setIsVerifying(true);
      setLivenessStatus('Verifying liveness with server...');

      const result = await faceMatcherAPI.livenessCheckFrame(blob);
      console.log('[LivenessCamera] Liveness check result:', result);

      const serverLive = !!(result && (result.isLive || result.live || result.success));
      const hasMotion = isMotionDetected();
      const hasTextureChange = isTextureChangeDetected();

      let isRealLive = false;

      if (serverLive && hasTextureChange) {
        isRealLive = true;
      }

      console.log('[LivenessCamera] Motion:', hasMotion, 'Texture change:', hasTextureChange);

      if (isRealLive) {
        setLivenessVerified(true);
        livenessVerifiedRef.current = true;
        setLivenessChecked(true);
        setBorderColor('green');
        setLivenessStatus('✓ Liveness verified. Blink to capture.');
        console.log('[LivenessCamera] REAL LIVENESS DETECTED — awaiting blink');
      } else {
        console.warn('[LivenessCamera] LIVENESS CHECK FAILED');
        setLivenessStatus('✗ Liveness check failed. Please ensure your face is live and moving.');
        setBorderColor('red');
        livenessCheckDoneRef.current = false;
        blinkStartedRef.current = false;
        livenessVerifiedRef.current = false;
      }
    } catch (err) {
      console.error('[LivenessCamera] Error verifying liveness:', err);
      setLivenessStatus('Error verifying liveness. Try again.');
      setBorderColor('red');
      livenessCheckDoneRef.current = false;
      blinkStartedRef.current = false;
      livenessVerifiedRef.current = false;
    } finally {
      setIsVerifying(false);
      verifyingRef.current = false;
    }
  }, [isMotionDetected, isTextureChangeDetected]);

  const [livenessChecked, setLivenessChecked] = useState(false);
  const [livenessVerified, setLivenessVerified] = useState(false);

  /** Main face processing */
  const onResults = useCallback(
    async (results) => {
      if (!processingEnabledRef.current) return;
      if (isCaptured) return;
      if (livenessCheckDoneRef.current) return;

      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) return;

      if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        setBorderColor('red');
        if (!livenessChecked) {
          setLivenessStatus('Position your face inside the frame');
        }
        return;
      }

      const landmarks = results.multiFaceLandmarks[0];

      let xs = landmarks.map((p) => p.x);
      let ys = landmarks.map((p) => p.y);
      let minX = Math.min(...xs);
      let maxX = Math.max(...xs);
      let minY = Math.min(...ys);
      let maxY = Math.max(...ys);

      const W = video.videoWidth;
      const H = video.videoHeight;
      const faceCenterX = ((minX + maxX) / 2) * W;
      const faceCenterY = ((minY + maxY) / 2) * H;

      faceHistoryRef.current.push({ centerX: faceCenterX, centerY: faceCenterY });
      if (faceHistoryRef.current.length > MAX_HISTORY) {
        faceHistoryRef.current.shift();
      }

      const luminance = getFrameLuminance(video);
      textureHistoryRef.current.push(luminance);
      if (textureHistoryRef.current.length > MAX_HISTORY) {
        textureHistoryRef.current.shift();
      }

      const leftIdx = [33, 160, 158, 133, 153, 144];
      const rightIdx = [362, 385, 387, 263, 373, 380];
      const leftPts = leftIdx.map((i) => landmarks[i]);
      const rightPts = rightIdx.map((i) => landmarks[i]);
      const leftEAR = getEAR(leftPts);
      const rightEAR = getEAR(rightPts);
      const avgEAR = (leftEAR + rightEAR) / 2;

      earHistoryRef.current.push(avgEAR);
      if (earHistoryRef.current.length > MAX_HISTORY) earHistoryRef.current.shift();

      const boxW = W * 0.4;
      const boxH = H * 0.4;
      const boxLeft = (W - boxW) / 2;
      const boxTop = (H - boxH) / 2;
      const boxRight = boxLeft + boxW;
      const boxBottom = boxTop + boxH;

      const centered =
        faceCenterX > boxLeft &&
        faceCenterX < boxRight &&
        faceCenterY > boxTop &&
        faceCenterY < boxBottom;

      if (!centered) {
        if (livenessVerified) {
          setLivenessVerified(false);
        }
        livenessVerifiedRef.current = false;
        setBorderColor('red');
        if (!livenessChecked) {
          setLivenessStatus('Center your face');
        }
        return;
      }

      if (!livenessVerifiedRef.current && !verifyingRef.current && !livenessCheckDoneRef.current) {
        console.log('[LivenessCamera] Face centered — initiating liveness verification');
        setLivenessStatus('Verifying liveness...');
        setLivenessChecked(true);
        verifyingRef.current = true;
        setIsVerifying(true);
        captureAndVerifyLiveness();
        return;
      }

      // Blink detection
      const CLOSE = 0.2;
      const OPEN = 0.27;

      if (!blinkStartedRef.current && avgEAR < CLOSE) {
        blinkStartedRef.current = true;
        console.log('[LivenessCamera] blink started');
      } else if (blinkStartedRef.current && avgEAR > OPEN) {
        blinkStartedRef.current = false;

        if (!livenessVerifiedRef.current) {
          console.log('[LivenessCamera] Blink ignored — liveness not yet verified');
          setLivenessStatus('Please complete liveness verification first');
          return;
        }

        try {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          const size = Math.min(video.videoWidth, video.videoHeight);
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const sx = (video.videoWidth - size) / 2;
          const sy = (video.videoHeight - size) / 2;
          ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);

          const dataUrl = canvas.toDataURL('image/jpeg');
          const blob = await (await fetch(dataUrl)).blob();
          const file = new File([blob], 'captured_photo.jpg', { type: 'image/jpeg' });

          setCapturedImage(URL.createObjectURL(blob));
          setLiveImage(file);
          setIsCaptured(true);
          setBorderColor('green');
          setLivenessStatus('✓ Photo captured.');
          livenessCheckDoneRef.current = true;

          await stopCamera();
          console.log('[LivenessCamera] Image captured and camera stopped');

          // Notify parent component
          if (onCaptureComplete) {
            onCaptureComplete();
          }
        } catch (err) {
          console.error('[LivenessCamera] Error capturing final image:', err);
          setLivenessStatus('Error capturing image. Try again.');
        }
      }
    },
    [
      getEAR,
      getFrameLuminance,
      captureAndVerifyLiveness,
      stopCamera,
      isCaptured,
      livenessChecked,
      livenessVerified,
      setLiveImage,
      onCaptureComplete,
    ]
  );

  /** Start Camera + FaceMesh */
  const startCamera = useCallback(() => {
    try {
      const faceMesh = new FaceMesh({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      faceMesh.onResults(onResults);
      faceMeshRef.current = faceMesh;
      faceMeshClosingRef.current = false;

      const video = videoRef.current;
      if (!video) {
        console.error('[LivenessCamera] Video element not found');
        return;
      }

      video.onerror = (err) => {
        console.error('[LivenessCamera] Video error:', err);
        setLivenessStatus('Camera error. Please refresh the page.');
      };

      const cam = new Camera(video, {
        onFrame: async () => {
          try {
            if (!processingEnabledRef.current || !faceMeshRef.current || faceMeshClosingRef.current) return;
            if (video && video.videoWidth > 0 && video.videoHeight > 0) {
              sendInProgressRef.current = true;
              try {
                await faceMesh.send({ image: video });
              } catch (sendErr) {
                faceMeshClosingRef.current = true;
                throw sendErr;
              } finally {
                sendInProgressRef.current = false;
              }
            }
          } catch (frameErr) {
            if (!faceMeshClosingRef.current) {
              console.warn('[LivenessCamera] Frame processing error:', frameErr && frameErr.message);
            }
            sendInProgressRef.current = false;
          }
        },
        width: 640,
        height: 480,
      });

      cameraRef.current = cam;
      cam.start();
    } catch (err) {
      console.error('[LivenessCamera] Failed to start camera:', err);
      setLivenessStatus('Failed to start camera. Check permissions.');
    }
  }, [onResults]);

  useEffect(() => {
    startCamera();
  }, [startCamera]);

  useEffect(() => {
    return () => {
      try {
        stopCamera();
      } catch (e) {
        console.warn('[LivenessCamera] Error during unmount cleanup', e);
      }
    };
  }, [stopCamera]);

  return (
    <div style={{ textAlign: 'center', marginTop: 20 }}>
      <h2 style={{ color: '#333', marginBottom: 15 }}>Face Liveness & Capture</h2>

      <div
        style={{
          position: 'relative',
          width: 320,
          height: 320,
          margin: '0 auto',
          borderRadius: '50%',
          overflow: 'hidden',
          border: `4px solid ${borderColor}`,
          transition: 'border-color 0.3s ease',
          backgroundColor: '#f0f0f0',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {isCaptured ? (
        <div style={{ marginTop: 15 }}>
          <div
            style={{
              position: 'relative',
              width: 320,
              height: 320,
              margin: '0 auto',
              borderRadius: '50%',
              overflow: 'hidden',
              border: '4px solid #28a745',
              backgroundColor: '#f0f0f0',
            }}
          >
            <img
              src={capturedImage}
              alt="Captured"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
          <p style={{ color: 'green', fontWeight: 'bold', marginTop: 15, fontSize: 16 }}>
            ✓ Photo captured successfully!
          </p>
        </div>
      ) : (
        <>
          <p
            style={{
              marginTop: 15,
              fontWeight: 'bold',
              fontSize: 14,
              color:
                borderColor === 'green'
                  ? '#28a745'
                  : borderColor === 'red'
                  ? '#dc3545'
                  : '#ff9800',
            }}
          >
            {livenessStatus}
          </p>

          {livenessVerified && !isVerifying && (
            <div style={{ marginTop: 12, fontSize: 14, color: '#28a745', fontWeight: '600' }}>
              Blink to capture
            </div>
          )}

          {isVerifying && (
            <div
              style={{
                marginTop: 15,
                padding: '12px 24px',
                fontSize: '16px',
                background: '#007bff',
                color: 'white',
                borderRadius: 8,
                fontWeight: 'bold',
              }}
            >
              ⏳ Verifying liveness with server...
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default LivenessCamera;