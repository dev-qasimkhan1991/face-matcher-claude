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

  const MAX_RETRIES = 3;
  const LIVENESS_ENDPOINT = process.env.REACT_APP_LIVENESS_ENDPOINT || 'http://localhost:3000';

  // Cleanup function
  const cleanup = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
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

  const createSession = async () => {
    if (sessionCreatedRef.current) {
      return;
    }

    if (captureCompleteRef.current) {
      return;
    }

    if (retryCount >= MAX_RETRIES) {
      setStatus('❌ Max retries exceeded. Please refresh and try again.');
      setLoading(false);
      return;
    }

    sessionCreatedRef.current = true;
    sessionIdRef.current = null;
    detectorKeyRef.current += 1;
    
    try {
      setLoading(true);
      setStatus('Creating liveness session...');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const resp = await fetch(`${LIVENESS_ENDPOINT}/liveness/create`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        throw new Error(`HTTP Error: ${resp.status}`);
      }

      const data = await resp.json();

      if (!data.sessionId) {
        throw new Error('No sessionId returned from backend');
      }

      if (!data.region) {
        throw new Error('No region returned from backend');
      }

      if (!data.identity) {
        throw new Error('No identity credentials returned from backend');
      }

      const sessionConfig = {
        sessionId: data.sessionId,
        region: data.region,
        identity: {
          ...data.identity,
          expiration: new Date(data.identity.expiration),
        },
      };

      // Validate expiration is valid date
      if (isNaN(sessionConfig.identity.expiration.getTime())) {
        throw new Error('Invalid expiration date from backend');
      }

      if (!isMountedRef.current || captureCompleteRef.current) {
        return;
      }

      setSessionData(sessionConfig);
      setStatus('Session ready — follow the on-screen instructions');
      
      sessionIdRef.current = sessionConfig.sessionId;
    } catch (err) {
      console.error('Session creation error:', err);
      
      if (err.name === 'AbortError') {
        setStatus('Request timeout. Retrying...');
      } else {
        setStatus(`Failed to create liveness session. Retry ${retryCount + 1}/${MAX_RETRIES}`);
      }

      setSessionData(null);
      setRetryCount(prev => prev + 1);
      hardReset();

      // Exponential backoff retry
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

    return () => {
      isMountedRef.current = false;
      if (initTimeout) clearTimeout(initTimeout);
      cleanup();
    };
  }, []);

  const base64ToFile = (
    imageData,
    filename = 'liveness_reference.jpg',
    mime = 'image/jpeg'
  ) => {
    try {
      if (!imageData) {
        throw new Error('No image data provided');
      }

      let blob;

      if (imageData instanceof Uint8Array) {
        blob = new Blob([imageData], { type: mime });
      }
      else if (imageData && typeof imageData === 'object' && !Array.isArray(imageData)) {
        const keys = Object.keys(imageData)
          .filter(k => !isNaN(k))
          .sort((a, b) => Number(a) - Number(b));
        
        if (keys.length === 0) {
          throw new Error('Invalid image object format');
        }

        const uint8Array = new Uint8Array(keys.length);
        keys.forEach((key, index) => {
          uint8Array[index] = imageData[key];
        });
        blob = new Blob([uint8Array], { type: mime });
      }
      else if (typeof imageData === 'string') {
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
      }
      else if (imageData && typeof imageData.length === 'number') {
        const uint8Array = new Uint8Array(Array.from(imageData));
        blob = new Blob([uint8Array], { type: mime });
      }
      else {
        throw new Error(`Unsupported image data format: ${typeof imageData}`);
      }

      if (blob.size === 0) {
        throw new Error('Converted blob is empty');
      }

      const file = new File([blob], filename, { type: mime });
      return file;
    } catch (err) {
      console.error('Image conversion error:', err);
      return null;
    }
  };

  const handleAnalysisComplete = async () => {
    if (handlingAnalysisRef.current) {
      return;
    }

    if (captureCompleteRef.current) {
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const resultUrl = `${LIVENESS_ENDPOINT}/liveness/result/${sessionData.sessionId}`;
      const resp = await fetch(resultUrl, { signal: controller.signal });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        throw new Error(`HTTP Error: ${resp.status}`);
      }

      const data = await resp.json();

      if (!data.Status) {
        throw new Error('No Status in response');
      }

      const confidence = data.Confidence || 0;
      const minConfidence = 90;

      if (data.Status !== 'SUCCEEDED' || confidence < minConfidence) {
        setStatus(`❌ Liveness verification failed\nConfidence: ${confidence.toFixed(1)}%\nPlease try again with a live face.`);
        
        handlingAnalysisRef.current = false;
        hardReset();
        timeoutRef.current = setTimeout(createSession, 2000);
        return;
      }

      let base64Bytes = null;

      if (data?.ReferenceImage?.Bytes) {
        base64Bytes = data.ReferenceImage.Bytes;
      } 
      else if (data?.AuditImages?.[0]?.Bytes) {
        base64Bytes = data.AuditImages[0].Bytes;
      }
      else if (data?.AuditImages?.[0]?.BoundingBox?.Bytes) {
        base64Bytes = data.AuditImages[0].BoundingBox.Bytes;
      }

      if (!base64Bytes) {
        setStatus('❌ No captured image found. Please try again.');
        
        handlingAnalysisRef.current = false;
        hardReset();
        timeoutRef.current = setTimeout(createSession, 2000);
        return;
      }

      const file = base64ToFile(base64Bytes);
      
      if (!file) {
        setStatus('❌ Error processing captured image.');
        handlingAnalysisRef.current = false;
        hardReset();
        timeoutRef.current = setTimeout(createSession, 2000);
        return;
      }

      captureCompleteRef.current = true;
      
      try {
        setLiveImage(file);
      } catch (callbackErr) {
        console.error('Error calling setLiveImage:', callbackErr);
        setStatus('❌ Error saving image. Please try again.');
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
      console.error('Analysis error:', err);
      
      if (err.name === 'AbortError') {
        setStatus('Request timeout. Please try again.');
      } else {
        setStatus('❌ Verification error. Restarting...');
      }
      
      handlingAnalysisRef.current = false;
      hardReset();
      timeoutRef.current = setTimeout(createSession, 2000);
    } finally {
      setLoading(false);
      handlingAnalysisRef.current = false;
    }
  };

  const handleError = async (err) => {
    if (captureCompleteRef.current) {
      return;
    }
    
    console.error('Liveness detector error:', err);
    setStatus('❌ Liveness check error. Restarting...');
    
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
    
    console.warn('User cancelled liveness check');
    setStatus('⚠️ Liveness check cancelled. Restarting...');
    
    hardReset();
    
    await new Promise(resolve => {
      timeoutRef.current = setTimeout(resolve, 1000);
    });

    if (isMountedRef.current) {
      await createSession();
    }
  };

  const buildCredentialProvider = (identity) => {
    if (!identity) {
      console.error('Identity is missing for credential provider');
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
        console.error('Credential provider error:', credErr);
        throw credErr;
      }
    };
  };

  return (
    <div className="liveness-container card">
      <h2 className="liveness-title">Face Liveness & Capture</h2>

      {isCaptured ? (
        <div className="liveness-captured">
          <img
            src={capturedPreview}
            alt="Live Capture"
            className="live-preview"
          />
          <p className="liveness-success-msg">
            ✓ Photo captured successfully!
          </p>
        </div>
      ) : (
        <>
          <p className="liveness-status">
            {status}
          </p>

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
                  /* Override Amplify FaceLivenessDetector styles for mobile */
                  .amplify-liveness-detector {
                    width: 100% !important;
                    max-width: 100% !important;
                    height: auto !important;
                    padding: 0 !important;
                    margin: 0 !important;
                  }

                  .amplify-liveness-detector > div {
                    width: 100% !important;
                    max-width: 100% !important;
                  }

                  /* Video stream container */
                  .amplify-video-stream {
                    width: 100% !important;
                    max-width: 100% !important;
                    height: auto !important;
                    display: flex !important;
                    justify-content: center !important;
                  }

                  /* Video element */
                  .amplify-liveness-detector video,
                  .amplify-liveness-detector canvas {
                    width: 100% !important;
                    max-width: 100% !important;
                    height: auto !important;
                    aspect-ratio: 1 / 1 !important;
                    border-radius: 16px !important;
                  }

                  /* Instruction text overlay */
                  .amplify-instruction-text {
                    font-size: clamp(14px, 3vw, 16px) !important;
                    padding: 12px !important;
                    margin: 8px 0 !important;
                    word-wrap: break-word !important;
                    overflow-wrap: break-word !important;
                  }

                  /* Button styles */
                  .amplify-button {
                    min-width: 44px !important;
                    min-height: 44px !important;
                    padding: 10px 16px !important;
                    font-size: clamp(12px, 2.5vw, 14px) !important;
                  }

                  /* Flexbox containers */
                  .amplify-flex {
                    display: flex !important;
                    flex-direction: column !important;
                    gap: 12px !important;
                    width: 100% !important;
                  }

                  /* Container padding */
                  .amplify-container {
                    padding: 0 !important;
                    width: 100% !important;
                  }

                  /* Close button positioning */
                  .amplify-close-button {
                    top: 12px !important;
                    right: 12px !important;
                    width: 40px !important;
                    height: 40px !important;
                    min-width: 40px !important;
                    min-height: 40px !important;
                    z-index: 10 !important;
                  }

                  /* Recording indicator */
                  .amplify-recording-badge {
                    font-size: clamp(12px, 2vw, 14px) !important;
                    padding: 8px 12px !important;
                  }

                  /* Ensure all Amplify elements respect mobile viewport */
                  @media (max-width: 480px) {
                    .amplify-liveness-detector {
                      overflow: hidden !important;
                    }

                    .amplify-instruction-text {
                      font-size: 13px !important;
                      padding: 10px !important;
                    }

                    .amplify-button {
                      padding: 8px 12px !important;
                      font-size: 13px !important;
                    }
                  }

                  /* Landscape mode adjustments */
                  @media (orientation: landscape) {
                    .amplify-liveness-detector video,
                    .amplify-liveness-detector canvas {
                      max-height: 60vh !important;
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