import '@aws-amplify/ui-react/styles.css';

import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  Loader,
  ThemeProvider,
} from '@aws-amplify/ui-react';
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';

const AmplifyLivenessCamera = ({ setLiveImage }) => {
  const [status, setStatus] = useState('Preparing liveness...');
  const [loading, setLoading] = useState(true);
  const [sessionData, setSessionData] = useState(null);
  const [capturedPreview, setCapturedPreview] = useState(null);
  const [isCaptured, setIsCaptured] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const handlingAnalysisRef = useRef(false);
  const sessionCreatedRef = useRef(false);
  const sessionIdRef = useRef(null);
  const detectorKeyRef = useRef(0);
  const captureCompleteRef = useRef(false);
  const isMountedRef = useRef(false);
  const timeoutRef = useRef(null);
  const abortControllerRef = useRef(null);

  const MAX_RETRIES = 3;

  const getLivenessEndpoint = () => {
    const endpoint = process.env.REACT_APP_API_BASE_URL;

    if (endpoint && endpoint.trim() !== '') {
      return endpoint;
    }

    let auto;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      auto = `${window.location.protocol}//${window.location.hostname}:3000`;
    } else {
      const port = window.location.port ? `:${window.location.port}` : '';
      auto = `${window.location.protocol}//${window.location.hostname}${port}`;
    }

    return auto;
  };

  const cleanup = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (capturedPreview) {
      URL.revokeObjectURL(capturedPreview);
    }
  };

  const hardReset = () => {
    if (captureCompleteRef.current) {
      return;
    }

    sessionCreatedRef.current = false;
    sessionIdRef.current = null;
    handlingAnalysisRef.current = false;
    detectorKeyRef.current += 1;
    setSessionData(null);
    setLoading(true);
  };

  const fetchWithTimeout = async (url, options = {}) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    const timeout = setTimeout(() => abortControllerRef.current.abort(), 30000);

    try {
      const response = await fetch(url, {
        ...options,
        signal: abortControllerRef.current.signal,
        mode: 'cors',
        credentials: 'omit',
        headers: {
          ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response;
    } catch (err) {
      clearTimeout(timeout);

      if (err.name === 'AbortError') {
        throw new Error('Request timeout');
      }

      throw err;
    }
  };

  const createSession = async () => {
    if (sessionCreatedRef.current || captureCompleteRef.current) {
      return;
    }

    if (retryCount >= MAX_RETRIES) {
      setStatus('Max retries exceeded. Please refresh and try again.');
      setLoading(false);
      return;
    }

    sessionCreatedRef.current = true;
    sessionIdRef.current = null;
    detectorKeyRef.current += 1;

    try {
      setLoading(true);
      setStatus('Creating liveness session...');

      const endpoint = getLivenessEndpoint();
      const url = `${endpoint}/liveness/create`;

      const response = await fetchWithTimeout(url, { method: 'GET' });
      const data = await response.json();

      if (!data.sessionId || !data.region || !data.identity) {
        throw new Error('Invalid session response');
      }

      const sessionConfig = {
        sessionId: data.sessionId,
        region: data.region,
        identity: {
          ...data.identity,
          expiration: new Date(data.identity.expiration),
        },
      };

      if (isNaN(sessionConfig.identity.expiration.getTime())) {
        throw new Error('Invalid expiration date');
      }

      if (!isMountedRef.current || captureCompleteRef.current) {
        return;
      }

      setSessionData(sessionConfig);
      setStatus('Session ready — follow the on-screen instructions');
      sessionIdRef.current = sessionConfig.sessionId;
    } catch (err) {
      let message = 'Failed to create liveness session';
      if (err.message.includes('timeout')) {
        message = 'Connection timeout. Retrying...';
      } else if (err.message.includes('404')) {
        message = 'Liveness service not available';
      }

      setStatus(`${message}. Retry ${retryCount + 1}/${MAX_RETRIES}`);
      setSessionData(null);
      setRetryCount(prev => prev + 1);
      hardReset();

      const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
      timeoutRef.current = setTimeout(createSession, delay);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;

    if (captureCompleteRef.current) {
      return;
    }

    hardReset();
    const initTimeout = setTimeout(createSession, 100);

    // Force CSS re-application every 500ms to counter Amplify's dynamic styles
    const styleEnforcementInterval = setInterval(() => {
      const videos = document.querySelectorAll('.amplify-liveness-detector video, .amplify-liveness-detector canvas');
      videos.forEach(video => {
        video.style.width = '100%';
        video.style.maxWidth = '100%';
        video.style.minWidth = '100%';
        video.style.minHeight = '500px';
        video.style.maxHeight = '80vh';
        video.style.aspectRatio = '3 / 4';
        video.style.objectFit = 'cover';
        video.style.borderRadius = '16px';
        video.style.transform = 'none';
        video.style.scale = '1';
      });
    }, 500);

    return () => {
      isMountedRef.current = false;
      if (initTimeout) clearTimeout(initTimeout);
      if (styleEnforcementInterval) clearInterval(styleEnforcementInterval);
      cleanup();
    };
  }, []);

  const base64ToFile = (imageData, filename = 'liveness_reference.jpg', mime = 'image/jpeg') => {
    try {
      if (!imageData) {
        throw new Error('No image data provided');
      }

      let blob;

      if (imageData instanceof Uint8Array) {
        blob = new Blob([imageData], { type: mime });
      } else if (imageData && typeof imageData === 'object' && !Array.isArray(imageData)) {
        const keys = Object.keys(imageData)
          .filter(k => !isNaN(k))
          .sort((a, b) => Number(a) - Number(b));

        if (keys.length === 0) {
          throw new Error('Invalid image object');
        }

        const uint8Array = new Uint8Array(keys.length);
        keys.forEach((key, index) => {
          uint8Array[index] = imageData[key];
        });
        blob = new Blob([uint8Array], { type: mime });
      } else if (typeof imageData === 'string') {
        const b64 = imageData.replace(/^data:image\/\w+;base64,/, '');
        if (!b64) {
          throw new Error('Invalid base64 string');
        }

        const binary = atob(b64);
        const len = binary.length;
        const array = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          array[i] = binary.charCodeAt(i);
        }
        blob = new Blob([array], { type: mime });
      } else if (imageData && typeof imageData.length === 'number') {
        const uint8Array = new Uint8Array(Array.from(imageData));
        blob = new Blob([uint8Array], { type: mime });
      } else {
        throw new Error(`Unsupported image format: ${typeof imageData}`);
      }

      if (blob.size === 0) {
        throw new Error('Image blob is empty');
      }

      const file = new File([blob], filename, { type: mime });
      return file;
    } catch (err) {
      return null;
    }
  };

  const handleAnalysisComplete = async () => {
    if (handlingAnalysisRef.current || captureCompleteRef.current) {
      return;
    }

    if (!sessionData?.sessionId || sessionIdRef.current !== sessionData.sessionId) {
      handlingAnalysisRef.current = false;
      return;
    }

    handlingAnalysisRef.current = true;

    setStatus('Liveness analysis complete — fetching results...');
    setLoading(true);

    try {
      const endpoint = getLivenessEndpoint();
      const resultUrl = `${endpoint}/liveness/result/${sessionData.sessionId}`;

      const response = await fetchWithTimeout(resultUrl, { method: 'GET' });
      const data = await response.json();

      if (!data.Status) {
        throw new Error('No Status in response');
      }

      const confidence = data.Confidence || 0;
      const minConfidence = 90;

      if (data.Status !== 'SUCCEEDED' || confidence < minConfidence) {
        setStatus(
          `Liveness verification failed\nConfidence: ${confidence.toFixed(1)}%\nPlease try again with a live face.`
        );

        handlingAnalysisRef.current = false;
        hardReset();
        timeoutRef.current = setTimeout(createSession, 2000);
        return;
      }

      let base64Bytes = null;

      if (data?.ReferenceImage?.Bytes) {
        base64Bytes = data.ReferenceImage.Bytes;
      } else if (data?.AuditImages?.[0]?.Bytes) {
        base64Bytes = data.AuditImages[0].Bytes;
      } else if (data?.AuditImages?.[0]?.BoundingBox?.Bytes) {
        base64Bytes = data.AuditImages[0].BoundingBox.Bytes;
      }

      if (!base64Bytes) {
        setStatus('No captured image found. Please try again.');

        handlingAnalysisRef.current = false;
        hardReset();
        timeoutRef.current = setTimeout(createSession, 2000);
        return;
      }

      const file = base64ToFile(base64Bytes);

      if (!file) {
        setStatus('Error processing captured image.');
        handlingAnalysisRef.current = false;
        hardReset();
        timeoutRef.current = setTimeout(createSession, 2000);
        return;
      }

      captureCompleteRef.current = true;

      try {
        setLiveImage(file);
      } catch (callbackErr) {
        setStatus('Error saving image. Please try again.');
        captureCompleteRef.current = false;
        handlingAnalysisRef.current = false;
        hardReset();
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      setCapturedPreview(previewUrl);

      setIsCaptured(true);
      setStatus('✓ Photo captured successfully!');

      setSessionData(null);
      sessionCreatedRef.current = false;
      sessionIdRef.current = null;
    } catch (err) {
      if (err.message.includes('timeout')) {
        setStatus('Request timeout. Retrying...');
      } else {
        setStatus('Verification error. Restarting...');
      }

      handlingAnalysisRef.current = false;
      hardReset();
      timeoutRef.current = setTimeout(createSession, 2000);
    } finally {
      setLoading(false);
      handlingAnalysisRef.current = false;
    }
  };

  const handleError = async err => {
    if (captureCompleteRef.current) {
      return;
    }

    setStatus('Liveness check error. Restarting...');

    hardReset();

    await new Promise(resolve => {
      timeoutRef.current = setTimeout(resolve, 1000);
    });

    if (isMountedRef.current) {
      await createSession();
    }
  };

  const handleUserCancel = async () => {
    if (captureCompleteRef.current) {
      return;
    }

    setStatus('Liveness check cancelled. Restarting...');

    hardReset();

    await new Promise(resolve => {
      timeoutRef.current = setTimeout(resolve, 1000);
    });

    if (isMountedRef.current) {
      await createSession();
    }
  };

  const buildCredentialProvider = identity => {
    if (!identity) {
      return undefined;
    }

    return async () => {
      try {
        if (!identity.accessKeyId || !identity.secretAccessKey) {
          throw new Error('Missing required credentials');
        }

        const credentials = {
          accessKeyId: identity.accessKeyId,
          secretAccessKey: identity.secretAccessKey,
          sessionToken: identity.sessionToken || '',
          expiration: new Date(identity.expiration),
        };

        if (isNaN(credentials.expiration.getTime())) {
          throw new Error('Invalid credential expiration');
        }

        return credentials;
      } catch (credErr) {
        throw credErr;
      }
    };
  };

  return (
    <div className="liveness-container card">
      <h2 className="liveness-title">Face Liveness & Capture</h2>

      {isCaptured ? (
        <div className="liveness-captured">
          <img src={capturedPreview} alt="Live Capture" className="live-preview" />
          <p className="liveness-success-msg">✓ Photo captured successfully!</p>
        </div>
      ) : (
        <>
          <p className="liveness-status">{status}</p>

          {loading ? (
            <div className="liveness-loader">
              <Loader />
              <p>Please wait...</p>
            </div>
          ) : (
            sessionData?.sessionId &&
            sessionIdRef.current === sessionData.sessionId &&
            !captureCompleteRef.current && (
              <div className="liveness-wrapper">
                <style>{`
                  /* CRITICAL: Force styles even during recording state */
                  .amplify-liveness-detector,
                  .amplify-liveness-detector *,
                  .amplify-liveness-detector video,
                  .amplify-liveness-detector canvas {
                    box-sizing: border-box !important;
                  }

                  /* Main detector container - Full width and height */
                  .amplify-liveness-detector {
                    width: 100% !important;
                    max-width: 100% !important;
                    min-width: 100% !important;
                    height: auto !important;
                    padding: 0 !important;
                    margin: 0 !important;
                  }

                  .amplify-liveness-detector > div,
                  .amplify-liveness-detector > div > div {
                    width: 100% !important;
                    max-width: 100% !important;
                    min-width: 100% !important;
                  }

                  /* Video stream container - Maximize height */
                  .amplify-video-stream,
                  .amplify-liveness-detector [class*="videoContainer"],
                  .amplify-liveness-detector [class*="video-container"] {
                    width: 100% !important;
                    max-width: 100% !important;
                    min-width: 100% !important;
                    height: auto !important;
                    display: flex !important;
                    justify-content: center !important;
                    align-items: center !important;
                  }

                  /* Video and canvas - ENLARGED - FORCE ALL STATES */
                  .amplify-liveness-detector video,
                  .amplify-liveness-detector canvas,
                  .amplify-liveness-detector video[class*="amplify"],
                  .amplify-liveness-detector canvas[class*="amplify"],
                  .amplify-video-stream video,
                  .amplify-video-stream canvas {
                    width: 100% !important;
                    max-width: 100% !important;
                    min-width: 100% !important;
                    height: auto !important;
                    min-height: 500px !important;
                    max-height: 80vh !important;
                    aspect-ratio: 3 / 4 !important;
                    border-radius: 16px !important;
                    object-fit: cover !important;
                    position: relative !important;
                  }

                  /* CRITICAL: Override recording state styles */
                  .amplify-liveness-detector[data-recording="true"] video,
                  .amplify-liveness-detector[data-recording="true"] canvas,
                  .amplify-liveness-detector.recording video,
                  .amplify-liveness-detector.recording canvas,
                  .amplify-liveness-detector[class*="recording"] video,
                  .amplify-liveness-detector[class*="recording"] canvas {
                    width: 100% !important;
                    max-width: 100% !important;
                    min-width: 100% !important;
                    height: auto !important;
                    min-height: 500px !important;
                    max-height: 80vh !important;
                    aspect-ratio: 3 / 4 !important;
                    transform: none !important;
                    scale: 1 !important;
                  }

                  /* Oval frame overlay - Adjust size for all states */
                  .amplify-liveness-detector .amplify-liveness-face-match-indicator,
                  .amplify-liveness-detector [class*="oval"],
                  .amplify-liveness-detector [class*="Oval"],
                  .amplify-liveness-detector [class*="freshness-indicator"] {
                    width: 85% !important;
                    height: 85% !important;
                    max-width: 450px !important;
                    max-height: 600px !important;
                  }

                  /* Instruction text - Keep readable */
                  .amplify-instruction-text,
                  .amplify-liveness-detector [class*="instruction"],
                  .amplify-liveness-detector [class*="Instruction"] {
                    font-size: clamp(14px, 3vw, 16px) !important;
                    padding: 12px !important;
                    margin: 8px 0 !important;
                    word-wrap: break-word !important;
                    overflow-wrap: break-word !important;
                    background: rgba(0,0,0,0.7) !important;
                    border-radius: 8px !important;
                  }

                  /* Buttons - Keep touchable */
                  .amplify-button,
                  .amplify-liveness-detector button {
                    min-width: 44px !important;
                    min-height: 44px !important;
                    padding: 10px 16px !important;
                    font-size: clamp(12px, 2.5vw, 14px) !important;
                  }

                  /* Close button - Position correctly */
                  .amplify-close-button,
                  .amplify-liveness-detector [class*="close"] button {
                    top: 12px !important;
                    right: 12px !important;
                    width: 40px !important;
                    height: 40px !important;
                    z-index: 1000 !important;
                  }

                  /* Recording indicator - Always visible */
                  .amplify-liveness-detector [class*="recording"],
                  .amplify-liveness-detector [class*="Recording"] {
                    top: 12px !important;
                    left: 12px !important;
                    z-index: 999 !important;
                  }

                  /* Mobile specific adjustments */
                  @media (max-width: 480px) {
                    .amplify-liveness-detector video,
                    .amplify-liveness-detector canvas,
                    .amplify-liveness-detector[data-recording="true"] video,
                    .amplify-liveness-detector[data-recording="true"] canvas {
                      min-height: 450px !important;
                      max-height: 75vh !important;
                      border-radius: 12px !important;
                    }

                    .amplify-instruction-text {
                      font-size: 13px !important;
                      padding: 10px !important;
                    }

                    .amplify-button {
                      padding: 8px 12px !important;
                      font-size: 13px !important;
                    }

                    /* Make oval frame larger on mobile */
                    .amplify-liveness-detector .amplify-liveness-face-match-indicator,
                    .amplify-liveness-detector [class*="oval"] {
                      width: 90% !important;
                      height: 90% !important;
                    }
                  }

                  /* Landscape mode - Adjust accordingly */
                  @media (orientation: landscape) {
                    .amplify-liveness-detector video,
                    .amplify-liveness-detector canvas {
                      max-height: 85vh !important;
                      aspect-ratio: 4 / 3 !important;
                    }
                  }

                  /* Portrait mode - Maximize vertical space */
                  @media (orientation: portrait) {
                    .amplify-liveness-detector video,
                    .amplify-liveness-detector canvas,
                    .amplify-liveness-detector[data-recording="true"] video,
                    .amplify-liveness-detector[data-recording="true"] canvas {
                      min-height: 550px !important;
                      max-height: 80vh !important;
                      aspect-ratio: 3 / 4 !important;
                    }
                  }

                  /* Tablets and larger phones */
                  @media (min-width: 481px) and (max-width: 768px) {
                    .amplify-liveness-detector video,
                    .amplify-liveness-detector canvas {
                      min-height: 600px !important;
                      max-height: 75vh !important;
                    }
                  }

                  /* Large screens */
                  @media (min-width: 769px) {
                    .amplify-liveness-detector video,
                    .amplify-liveness-detector canvas {
                      max-width: 600px !important;
                      min-height: 700px !important;
                      max-height: 80vh !important;
                      margin: 0 auto !important;
                    }
                  }

                  /* iOS Safari specific fixes */
                  @supports (-webkit-touch-callout: none) {
                    .amplify-liveness-detector video,
                    .amplify-liveness-detector canvas {
                      -webkit-transform: translateZ(0) !important;
                      transform: translateZ(0) !important;
                      backface-visibility: hidden !important;
                      -webkit-backface-visibility: hidden !important;
                    }
                  }
                `}</style>
                <ThemeProvider key={detectorKeyRef.current}>
                  <FaceLivenessDetector
                    sessionId={sessionData.sessionId}
                    region={sessionData.region}
                    onAnalysisComplete={handleAnalysisComplete}
                    onError={handleError}
                    onUserCancel={handleUserCancel}
                    config={{
                      credentialProvider: buildCredentialProvider(sessionData.identity),
                    }}
                  />
                </ThemeProvider>
              </div>
            )
          )}
        </>
      )}

      <style>{`
        .liveness-container {
          width: 100%;
          max-width: 100%;
          overflow: hidden;
        }

        .liveness-title {
          font-size: clamp(1.2rem, 3.5vw, 1.5rem);
          color: white;
          margin-bottom: 1rem;
          text-align: center;
          font-weight: 600;
        }

        .liveness-status {
          text-align: center;
          color: rgba(255, 255, 255, 0.7);
          margin: 12px 0;
          font-size: clamp(0.85rem, 2.5vw, 1rem);
          word-wrap: break-word;
          overflow-wrap: break-word;
          white-space: pre-wrap;
          line-height: 1.4;
        }

        .liveness-loader {
          text-align: center;
          padding: clamp(1.5rem, 4vw, 2rem);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        .liveness-loader p {
          color: rgba(255, 255, 255, 0.6);
          font-size: clamp(0.9rem, 2vw, 1rem);
          margin: 0;
        }

        .liveness-captured {
          text-align: center;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        .liveness-success-msg {
          color: #10b981;
          font-weight: bold;
          margin: 0;
          font-size: clamp(0.9rem, 2.5vw, 1.1rem);
        }

        .liveness-wrapper {
          width: 100%;
          max-width: 100%;
          overflow: hidden;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        @media (max-width: 480px) {
          .liveness-container {
            padding: 1rem !important;
          }
        }
      `}</style>
    </div>
  );
};

export default AmplifyLivenessCamera;