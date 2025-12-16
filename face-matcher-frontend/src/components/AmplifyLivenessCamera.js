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

  const handlingAnalysisRef = useRef(false);
  const sessionCreatedRef = useRef(false);
  const sessionIdRef = useRef(null);
  const detectorKeyRef = useRef(0);
  // 🔥 NEW: Track if capture is permanently complete
  const captureCompleteRef = useRef(false);
  // 🔥 NEW: Track component mount status
  const isMountedRef = useRef(false);

  // 🔥 NUCLEAR RESET FUNCTION + BETTER ERROR LOGGING FIX
  const hardReset = () => {
    console.log('[NUCLEAR] 🔴 HARD RESET - Full cleanup');
    
    // Don't reset if capture is already complete
    if (captureCompleteRef.current) {
      console.log('[NUCLEAR] ⚠️ Capture already complete, skipping reset');
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
    // 🔧 PATCH: prevents duplicate session creation
    if (sessionCreatedRef.current) {
      console.warn('[PATCH] Session already created, skipping');
      return;
    }

    // 🔥 NEW: Don't create session if capture is complete
    if (captureCompleteRef.current) {
      console.log('[createSession] ⚠️ Capture already complete, aborting session creation');
      return;
    }

    sessionCreatedRef.current = true;
    sessionIdRef.current = null;
    detectorKeyRef.current += 1;
    
    console.log('[AmplifyLivenessCamera] 🔵 START: Creating new liveness session...');
    try {
      setLoading(true);
      setStatus('Creating liveness session...');

      const resp = await fetch('http://localhost:3000/liveness/create');
      console.log('[AmplifyLivenessCamera] 🔵 Session API response status:', resp.status);
      
      const data = await resp.json();
      console.log('[AmplifyLivenessCamera] 🔵 Session data received:', {
        sessionId: data.sessionId,
        region: data.region,
        hasIdentity: !!data.identity,
        identityKeys: data.identity ? Object.keys(data.identity) : [],
      });

      if (!data.sessionId) {
        throw new Error('No sessionId returned from backend');
      }

      // ✅ Convert expiration to Date object
      const sessionConfig = {
        sessionId: data.sessionId,
        region: data.region,
        identity: {
          ...data.identity,
          expiration: new Date(data.identity.expiration),
        },
      };

      console.log('[AmplifyLivenessCamera] 🟢 Session created successfully:', {
        sessionId: sessionConfig.sessionId,
        expirationConverted: sessionConfig.identity.expiration instanceof Date,
      });

      // 🔥 NEW: Check if component is still mounted and capture not complete
      if (!isMountedRef.current || captureCompleteRef.current) {
        console.log('[createSession] ⚠️ Component unmounted or capture complete, discarding session');
        return;
      }

      setSessionData(sessionConfig);
      setStatus('Session ready — follow the on-screen instructions');
      
      sessionIdRef.current = sessionConfig.sessionId;
      console.log('[AmplifyLivenessCamera] 🟢 SessionId tracked:', sessionIdRef.current);
    } catch (err) {
      console.error('[AmplifyLivenessCamera] 🔴 ERROR creating session:', err);
      setStatus('Failed to create liveness session. Try refreshing.');
      setSessionData(null);
      hardReset();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log('[AmplifyLivenessCamera] 🔵 Component mounted, initializing session...');
    isMountedRef.current = true;
    
    // 🔥 NEW: Don't initialize if already captured
    if (captureCompleteRef.current) {
      console.log('[AmplifyLivenessCamera] ⚠️ Already captured, skipping initialization');
      return;
    }
    
    hardReset();
    setTimeout(createSession, 100);
    
    // Cleanup on unmount
    return () => {
      console.log('[AmplifyLivenessCamera] 🔵 Component unmounting...');
      isMountedRef.current = false;
    };
  }, []);

  const base64ToFile = (
    imageData,
    filename = 'liveness_reference.jpg',
    mime = 'image/jpeg'
  ) => {
    console.log('[AmplifyLivenessCamera] 🔵 Converting image data to file...', {
      dataType: typeof imageData,
      isString: typeof imageData === 'string',
      isObject: typeof imageData === 'object',
      isUint8Array: imageData instanceof Uint8Array,
      dataLength: imageData?.length,
      hasNumericKeys: imageData && typeof imageData === 'object' && !Array.isArray(imageData) && Object.keys(imageData).some(k => !isNaN(k)),
      firstFewBytes: imageData && typeof imageData === 'object' ? 
        Object.keys(imageData).slice(0, 10).map(k => imageData[k]) : 
        null,
      filename,
    });

    try {
      let blob;

      if (imageData instanceof Uint8Array) {
        console.log('[AmplifyLivenessCamera] 🟢 Data is Uint8Array, creating blob directly');
        blob = new Blob([imageData], { type: mime });
      }
      else if (imageData && typeof imageData === 'object' && !Array.isArray(imageData)) {
        console.log('[AmplifyLivenessCamera] 🟡 Data is plain object with numeric keys, converting...');
        const keys = Object.keys(imageData).filter(k => !isNaN(k)).sort((a, b) => Number(a) - Number(b));
        const uint8Array = new Uint8Array(keys.length);
        keys.forEach((key, index) => {
          uint8Array[index] = imageData[key];
        });
        console.log('[AmplifyLivenessCamera] 🟢 Converted object to Uint8Array:', {
          arrayLength: uint8Array.length,
          firstBytes: Array.from(uint8Array.slice(0, 10)),
        });
        blob = new Blob([uint8Array], { type: mime });
      }
      else if (typeof imageData === 'string') {
        console.log('[AmplifyLivenessCamera] 🟡 Data is string (base64), decoding...');
        const b64 = imageData.replace(/^data:image\/\w+;base64,/, '');
        const binary = atob(b64);
        const len = binary.length;
        const array = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          array[i] = binary.charCodeAt(i);
        }
        blob = new Blob([array], { type: mime });
      }
      else if (imageData && typeof imageData.length === 'number') {
        console.log('[AmplifyLivenessCamera] 🟡 Data is array-like, converting...');
        const uint8Array = new Uint8Array(Array.from(imageData));
        blob = new Blob([uint8Array], { type: mime });
      }
      else {
        console.error('[AmplifyLivenessCamera] 🔴 Unsupported image data format:', {
          type: typeof imageData,
          constructor: imageData?.constructor?.name,
          keys: imageData && typeof imageData === 'object' ? Object.keys(imageData).slice(0, 20) : null,
        });
        throw new Error(`Unsupported image data format: ${typeof imageData}`);
      }

      const file = new File([blob], filename, { type: mime });
      console.log('[AmplifyLivenessCamera] 🟢 File created successfully:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        blobSize: blob.size,
      });
      
      return file;
    } catch (err) {
      console.error('[AmplifyLivenessCamera] 🔴 ERROR converting image data to file:', err);
      console.error('[AmplifyLivenessCamera] 🔴 Error stack:', err.stack);
      return null;
    }
  };

  const handleAnalysisComplete = async () => {
    console.log('[AmplifyLivenessCamera] 🟡 ===== ANALYSIS COMPLETE TRIGGERED =====');
    console.log('[AmplifyLivenessCamera] 🟡 Current state:', {
      hasSessionData: !!sessionData,
      sessionId: sessionData?.sessionId,
      alreadyHandling: handlingAnalysisRef.current,
      isCaptured,
      captureComplete: captureCompleteRef.current,
    });

    // 🔧 PATCH: Block duplicate calls
    if (handlingAnalysisRef.current) {
      console.warn('[PATCH] Duplicate analysisComplete blocked');
      return;
    }

    // 🔥 NEW: Block if already captured
    if (captureCompleteRef.current) {
      console.warn('[handleAnalysisComplete] ⚠️ Capture already complete, ignoring');
      return;
    }

    if (!sessionData?.sessionId || sessionIdRef.current !== sessionData.sessionId) {
      console.warn('[AmplifyLivenessCamera] ⚠️ Invalid/expired session, aborting...');
      handlingAnalysisRef.current = false;
      return;
    }

    handlingAnalysisRef.current = true;
    console.log('[AmplifyLivenessCamera] 🔵 Starting to fetch liveness results...');
    
    setStatus('Liveness analysis complete — fetching results...');
    setLoading(true);

    try {
      const resultUrl = `http://localhost:3000/liveness/result/${sessionData.sessionId}`;
      console.log('[AmplifyLivenessCamera] 🔵 Fetching from:', resultUrl);

      const resp = await fetch(resultUrl);
      console.log('[AmplifyLivenessCamera] 🔵 Result API response status:', resp.status);

      const data = await resp.json();
      console.log('[AmplifyLivenessCamera] 🔵 Full liveness result data:', JSON.stringify(data, null, 2));
      console.log('[AmplifyLivenessCamera] 🔵 Result structure:', {
        hasReferenceImage: !!data?.ReferenceImage,
        hasReferenceImageBytes: !!data?.ReferenceImage?.Bytes,
        hasAuditImages: !!data?.AuditImages,
        auditImagesCount: data?.AuditImages?.length || 0,
        status: data?.Status,
        confidence: data?.Confidence,
      });

      // 🔥🔥 STRICT ANTI-SPOOFING - 90% CONFIDENCE REQUIRED
      if (data.Status !== 'SUCCEEDED' || (data.Confidence && data.Confidence < 90)) {
        console.log('🔴 SPOOF SUSPECTED - Confidence too low:', data.Confidence);
        setStatus(`❌ Liveness failed - Confidence: ${data.Confidence?.toFixed(1) || 'N/A'}% (Use LIVE face only)`);
        
        handlingAnalysisRef.current = false;
        hardReset();
        setTimeout(createSession, 2000);
        return;
      }

      let base64Bytes = null;

      if (data?.ReferenceImage?.Bytes) {
        console.log('[AmplifyLivenessCamera] 🟢 Found ReferenceImage.Bytes');
        base64Bytes = data.ReferenceImage.Bytes;
      } 
      else if (data?.AuditImages?.[0]?.Bytes) {
        console.log('[AmplifyLivenessCamera] 🟡 Using AuditImages[0].Bytes as fallback');
        base64Bytes = data.AuditImages[0].Bytes;
      }
      else if (data?.AuditImages?.[0]?.BoundingBox?.Bytes) {
        console.log('[AmplifyLivenessCamera] 🟡 Using AuditImages[0].BoundingBox.Bytes');
        base64Bytes = data.AuditImages[0].BoundingBox.Bytes;
      }

      if (!base64Bytes) {
        console.error('[AmplifyLivenessCamera] 🔴 No image bytes found in response!');
        console.error('[AmplifyLivenessCamera] 🔴 Available keys in data:', Object.keys(data || {}));
        setStatus('No captured image found. Please try again.');
        
        handlingAnalysisRef.current = false;
        hardReset();
        setTimeout(createSession, 2000);
        return;
      }

      console.log('[AmplifyLivenessCamera] 🟢 Image bytes found, converting to file...');
      const file = base64ToFile(base64Bytes);
      
      if (!file) {
        console.error('[AmplifyLivenessCamera] 🔴 Failed to convert base64 to file');
        setStatus('Error processing captured image.');
        handlingAnalysisRef.current = false;
        hardReset();
        setTimeout(createSession, 2000);
        return;
      }

      console.log('[AmplifyLivenessCamera] 🟢 Setting live image to parent component...');
      
      // 🔥 NEW: Mark capture as permanently complete BEFORE setting state
      captureCompleteRef.current = true;
      
      setLiveImage(file);
      
      const previewUrl = URL.createObjectURL(file);
      console.log('[AmplifyLivenessCamera] 🟢 Preview URL created:', previewUrl);
      setCapturedPreview(previewUrl);
      
      setIsCaptured(true);
      setStatus('✓ Photo captured successfully!');
      
      console.log('[AmplifyLivenessCamera] 🟢 ===== CAPTURE COMPLETE =====');
      
      // 🔥 MODIFIED: Don't reset after success, just clean up session data
      setSessionData(null);
      sessionCreatedRef.current = false;
      sessionIdRef.current = null;
    } catch (err) {
      console.error('[AmplifyLivenessCamera] 🔴 ERROR in handleAnalysisComplete:', err);
      console.error('[AmplifyLivenessCamera] 🔴 Error stack:', err.stack);
      setStatus('Error retrieving liveness results.');
      
      handlingAnalysisRef.current = false;
      hardReset();
      setTimeout(createSession, 2000);
    } finally {
      setLoading(false);
      handlingAnalysisRef.current = false;
    }
  };

  const handleError = async (err) => {
    console.error('[AmplifyLivenessCamera] 🔴 FaceLivenessDetector ERROR:', err);
    console.error('[AmplifyLivenessCamera] 🔴 Raw error:', JSON.stringify(err, null, 2));
    console.error('[AmplifyLivenessCamera] 🔴 Error name:', err?.name || err?.error?.name);
    console.error('[AmplifyLivenessCamera] 🔴 Error message:', err?.message || err?.error?.message);
    console.error('[AmplifyLivenessCamera] 🔴 Error details:', JSON.stringify(err, null, 2));
    
    // 🔥 NEW: Don't restart if capture is complete
    if (captureCompleteRef.current) {
      console.log('[handleError] ⚠️ Capture already complete, ignoring error');
      return;
    }
    
    setStatus('Error during liveness check. Restarting...');
    
    hardReset();
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    await createSession();
  };

  const handleUserCancel = async () => {
    console.log('[AmplifyLivenessCamera] 🟡 User cancelled liveness check');
    
    // 🔥 NEW: Don't restart if capture is complete
    if (captureCompleteRef.current) {
      console.log('[handleUserCancel] ⚠️ Capture already complete, ignoring cancel');
      return;
    }
    
    setStatus('Liveness check cancelled. Restarting...');
    
    hardReset();
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    await createSession();
  };

  const buildCredentialProvider = (identity) => {
    if (!identity) {
      console.warn('[AmplifyLivenessCamera] ⚠️ No identity provided for credential provider');
      return undefined;
    }

    console.log('[AmplifyLivenessCamera] 🔵 Building credential provider with identity');

    return async () => {
      const credentials = {
        accessKeyId: identity.accessKeyId,
        secretAccessKey: identity.secretAccessKey,
        sessionToken: identity.sessionToken,
        expiration: new Date(identity.expiration),
      };

      console.log('[AmplifyLivenessCamera] 🔵 Credentials built:', {
        hasAccessKey: !!credentials.accessKeyId,
        hasSecretKey: !!credentials.secretAccessKey,
        hasSessionToken: !!credentials.sessionToken,
        expirationIsDate: credentials.expiration instanceof Date,
        expirationValue: credentials.expiration,
      });

      return credentials;
    };
  };

  console.log('[AmplifyLivenessCamera] 🔵 Render - Current state:', {
    loading,
    isCaptured,
    hasSessionData: !!sessionData,
    sessionId: sessionData?.sessionId,
    status,
    detectorKey: detectorKeyRef.current,
    captureComplete: captureCompleteRef.current,
  });

  return (
    <div className="card">
      <h2 className="title">Face Liveness & Capture</h2>

      {isCaptured ? (
        <div style={{ textAlign: 'center', marginTop: 15 }}>
          <img
            src={capturedPreview}
            alt="Live Capture"
            className="live-preview"
          />
          <p
            style={{
              color: 'green',
              fontWeight: 'bold',
              marginTop: 15,
              fontSize: 16,
            }}
          >
            ✓ Photo captured successfully!
          </p>
        </div>
      ) : (
        <>
          <p style={{ textAlign: 'center', color: '#666', margin: '15px 0' }}>
            {status}
          </p>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 30 }}>
              <Loader />
              <p style={{ marginTop: 10, color: '#999' }}>Please wait...</p>
            </div>
          ) : (
            sessionData?.sessionId && 
            sessionIdRef.current === sessionData.sessionId && 
            !captureCompleteRef.current && (
              <ThemeProvider key={detectorKeyRef.current}>
                <FaceLivenessDetector
                  sessionId={sessionData.sessionId}
                  region={sessionData.region}
                  onAnalysisComplete={handleAnalysisComplete}
                  onError={handleError}
                  onUserCancel={handleUserCancel}
                  config={{
                    credentialProvider: buildCredentialProvider(
                      sessionData.identity
                    ),
                  }}
                />
              </ThemeProvider>
            )
          )}
        </>
      )}
    </div>
  );
};

export default AmplifyLivenessCamera;