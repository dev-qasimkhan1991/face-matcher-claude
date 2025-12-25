import '../styles.css';

import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import AadhaarInput from './AadhaarInput';
import AmplifyLivenessCamera from './AmplifyLivenessCamera';
import MatchResult from './MatchResult';

function FaceMatcherPage() {
  const [ppoNumber, setPpoNumber] = useState('');
  const [aadhaarImage, setAadhaarImage] = useState(null);
  const [liveImage, setLiveImage] = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [debugInfo, setDebugInfo] = useState('');

  const compareInProgressRef = useRef(false);
  const abortControllerRef = useRef(null);

  const getApiEndpoint = () => {
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

  // Enhanced fetch with iOS Safari compatibility
  const fetchWithTimeout = async (url, options = {}, timeoutMs = 30000) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    const timeoutId = setTimeout(() => {
      console.error('⏱️ Request timeout after', timeoutMs, 'ms');
      abortControllerRef.current.abort();
    }, timeoutMs);

    try {
      // Detect iOS/Safari
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      
      console.log('🌐 Fetch Request:', {
        url,
        method: options.method || 'GET',
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        isIOS,
        isSafari,
        connectionType: navigator.connection?.effectiveType || 'unknown',
        online: navigator.onLine,
        isFormData: options.body instanceof FormData,
      });

      // For FormData, don't set Content-Type header (browser sets it with boundary)
      const headers = options.body instanceof FormData 
        ? { 
            'Accept': 'application/json, */*',
            ...options.headers 
          }
        : { 
            'Accept': 'application/json, */*',
            'Content-Type': 'application/json',
            ...options.headers 
          };

      // iOS Safari needs these specific settings
      const fetchOptions = {
        ...options,
        signal: abortControllerRef.current.signal,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store', // Changed from no-cache to no-store for iOS
        headers: headers,
      };

      // Add redirect handling for iOS
      if (isIOS || isSafari) {
        fetchOptions.redirect = 'follow';
      }

      const response = await fetch(url, fetchOptions);

      clearTimeout(timeoutId);

      console.log('✅ Response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        url: response.url,
        headers: Object.fromEntries(response.headers.entries()),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ HTTP Error Response:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        });
        
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }

      return response;

    } catch (err) {
      clearTimeout(timeoutId);

      console.error('❌ Fetch Error:', {
        name: err.name,
        message: err.message,
        stack: err.stack,
        type: err.constructor.name,
      });

      if (err.name === 'AbortError') {
        throw new Error('Request timeout. Please check your internet connection and try again.');
      }

      if (err.message.includes('Failed to fetch') || err.name === 'TypeError') {
        // iOS Safari specific error messages
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        if (isIOS) {
          throw new Error('Connection failed. If using cellular data, try WiFi or disable Low Data Mode in Settings.');
        }
        throw new Error('Network error. Please check your internet connection and try again.');
      }

      throw err;
    }
  };

  const handleFetch = async () => {
    setError('');
    setDebugInfo('');

    if (!ppoNumber.trim()) {
      setError('Please enter PPO Number');
      return;
    }

    setLoading(true);
    
    // Show debug info
    const debugData = {
      timestamp: new Date().toISOString(),
      ppoNumber: ppoNumber.trim(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      online: navigator.onLine,
      connectionType: navigator.connection?.effectiveType || 'unknown',
      endpoint: getApiEndpoint(),
    };
    
    console.log('🔍 Debug Info:', debugData);
    setDebugInfo(JSON.stringify(debugData, null, 2));

    let attempts = 0;
    const maxAttempts = 5; // Increased from 3 to 5

    const fetchAadhaar = async () => {
      try {
        attempts++;
        console.log(`🔄 Attempt ${attempts}/${maxAttempts}`);

        const apiEndpoint = getApiEndpoint();
        const proxyUrl = `${apiEndpoint}/api/aadhar/getCandidateDetails?ppoNumber=${encodeURIComponent(ppoNumber.trim())}`;

        console.log('📡 Calling API:', proxyUrl);

        // Increased timeout for first attempt (connection establishment)
        const timeoutMs = attempts === 1 ? 45000 : 30000;

        const response = await fetchWithTimeout(proxyUrl, {
          method: 'GET',
        }, timeoutMs);

        const contentType = response.headers.get('content-type');
        console.log('📄 Content-Type:', contentType);

        if (!contentType || !contentType.includes('application/json')) {
          throw new Error(`Invalid response format: ${contentType}`);
        }

        const data = await response.json();

        console.log('📦 Response Data:', {
          success: data.success,
          hasData: !!data.data,
          hasPhoto: !!data.data?.aadhaarPhotoUrl,
          message: data.message,
        });

        if (!data) {
          throw new Error('Empty response from server');
        }

        if (!data.success) {
          throw new Error(data.message || data.error || 'Failed to fetch Aadhaar details');
        }

        if (data.success && data.data?.aadhaarPhotoUrl) {
          let url = data.data.aadhaarPhotoUrl;

          // Clean up URL
          url = url
            .replace(/\/\//g, '/')
            .replace('http:/', 'http://')
            .replace('https:/', 'https://');

          console.log('✅ Aadhaar photo URL:', url);

          setAadhaarImage(url);
          setLiveImage(null);
          setMatchResult(null);
          setLoading(false);
          setDebugInfo('');
          return;
        }

        throw new Error(data.message || 'No Aadhaar photo found for this PPO Number');

      } catch (err) {
        console.error(`❌ Attempt ${attempts} failed:`, err);

        if (attempts < maxAttempts) {
          // Progressive delay: 1s, 2s, 3s, 4s, 5s
          const delay = Math.min(1000 * attempts, 5000);
          console.log(`⏳ Retrying in ${delay}ms...`);
          
          setError(`Establishing connection... Please wait (Attempt ${attempts}/${maxAttempts})`);
          
          await new Promise(resolve => setTimeout(resolve, delay));
          return fetchAadhaar();
        }

        // Final error after all retries
        let errorMessage = 'Failed to fetch Aadhaar details after multiple attempts. ';

        if (err.message.includes('timeout')) {
          errorMessage += 'Your network might be slow. Please try again or switch to a faster connection.';
        } else if (err.message.includes('Network error') || err.message.includes('Failed to fetch')) {
          errorMessage += 'Network connection issue. Please check your internet and try again.';
        } else if (err.message.includes('CORS')) {
          errorMessage += 'Server connection error. Please try again later.';
        } else if (err.message.includes('404')) {
          errorMessage += 'PPO Number not found in the system.';
        } else if (err.message.includes('500')) {
          errorMessage += 'Server error. Please try again later.';
        } else {
          errorMessage += err.message || 'Please try again.';
        }

        setError(errorMessage);
        setLoading(false);
      }
    };

    await fetchAadhaar();
  };

  const handleCompare = async () => {
    if (compareInProgressRef.current) {
      return;
    }

    compareInProgressRef.current = true;

    if (!aadhaarImage || !liveImage) {
      compareInProgressRef.current = false;
      return;
    }

    try {
      setLoading(true);
      setError('');

      console.log('🔄 Starting face comparison...', {
        aadhaarImage,
        liveImageType: liveImage?.constructor?.name,
        liveImageSize: liveImage?.size,
      });

      const formData = new FormData();
      formData.append('aadhaarUrl', aadhaarImage);

      if (liveImage instanceof File) {
        console.log('✅ Live image is File:', liveImage.name, liveImage.size, 'bytes');
        formData.append('image2', liveImage);
      } else if (liveImage instanceof Blob) {
        console.log('✅ Live image is Blob, converting to File...');
        const file = new File([liveImage], 'liveness_reference.jpg', { type: 'image/jpeg' });
        console.log('✅ File created:', file.name, file.size, 'bytes');
        formData.append('image2', file);
      } else {
        console.error('❌ Invalid live image type:', typeof liveImage);
        setError('Invalid image format');
        compareInProgressRef.current = false;
        setLoading(false);
        return;
      }

      // Log FormData contents (for debugging)
      console.log('📦 FormData contents:');
      for (let pair of formData.entries()) {
        console.log(`  ${pair[0]}:`, pair[1] instanceof File ? `File(${pair[1].name}, ${pair[1].size} bytes)` : pair[1]);
      }

      const apiEndpoint = getApiEndpoint();
      const compareUrl = `${apiEndpoint}/compare`;

      console.log('📡 Comparing faces at:', compareUrl);

      const response = await fetchWithTimeout(compareUrl, {
        method: 'POST',
        body: formData,
      }, 60000); // 60 second timeout for comparison

      const data = await response.json();

      console.log('✅ Comparison result:', data);

      if (!data) {
        throw new Error('No response from comparison server');
      }

      setMatchResult(data);
      compareInProgressRef.current = true;
    } catch (err) {
      console.error('❌ Comparison error:', err);
      
      let errorMessage = 'Comparison failed. ';
      
      if (err.message.includes('timeout')) {
        errorMessage += 'The comparison took too long. Please try again.';
      } else if (err.message.includes('Network error')) {
        errorMessage += 'Network connection issue. Please check your internet.';
      } else {
        errorMessage += err.message || 'Please try again.';
      }
      
      setError(errorMessage);
      compareInProgressRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (aadhaarImage && liveImage && !matchResult) {
      const timer = setTimeout(() => {
        handleCompare();
      }, 400);

      return () => clearTimeout(timer);
    }
  }, [aadhaarImage, liveImage, matchResult]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Pre-warm connection on component mount
  useEffect(() => {
    const warmUpConnection = async () => {
      try {
        console.log('🔥 Warming up connection to backend...');
        const apiEndpoint = getApiEndpoint();
        
        // Make a lightweight health check to establish connection
        const response = await fetch(`${apiEndpoint}/health`, {
          method: 'GET',
          mode: 'cors',
          cache: 'no-store',
          credentials: 'omit',
        });
        
        if (response.ok) {
          console.log('✅ Connection warmed up successfully');
        }
      } catch (err) {
        console.warn('⚠️ Connection warm-up failed (this is OK):', err.message);
      }
    };

    // Warm up connection immediately when component loads
    warmUpConnection();
  }, []);

  // Check network status and iOS-specific issues
  useEffect(() => {
    const handleOnline = () => {
      console.log('✅ Network connection restored');
      setError('');
    };

    const handleOffline = () => {
      console.log('❌ Network connection lost');
      setError('No internet connection. Please check your network.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check initial status
    if (!navigator.onLine) {
      setError('No internet connection. Please check your network.');
    }

    // iOS-specific: Detect Low Data Mode (iOS 13+)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS && navigator.connection) {
      if (navigator.connection.saveData) {
        console.warn('⚠️ iOS Low Data Mode detected');
        // Don't set error, just log it
      }
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <div className="container">
      <h1 className="main-title">AI Face Verification Pro</h1>

      {/* Network Status Indicator */}
      {!navigator.onLine && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.2)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: '12px',
          padding: '12px',
          marginBottom: '16px',
          textAlign: 'center',
          color: '#fca5a5',
        }}>
          ⚠️ No Internet Connection
        </div>
      )}

      <AadhaarInput
        ppoNumber={ppoNumber}
        setPpoNumber={setPpoNumber}
        handleFetch={handleFetch}
        isLoading={loading && !aadhaarImage}
      />

      {loading && !aadhaarImage && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{
            display: 'inline-block',
            width: '40px',
            height: '40px',
            border: '4px solid rgba(255,255,255,0.3)',
            borderTop: '4px solid #6366f1',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: '16px',
          }} />
          <p className="loading">
            ⏳ Loading…
            <br />
            <small>Establishing secure connection...</small>
            <br />
            <small style={{ opacity: 0.6, fontSize: '0.85em' }}>
              First request may take a few seconds
            </small>
          </p>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {error && (
        <div className="error" role="alert">
          <strong>⚠️ Error:</strong> {error}
          <br />
          <small style={{ marginTop: '8px', display: 'block', opacity: 0.8 }}>
            Having trouble? Try:
            <br />
            • Check your internet connection
            <br />
            • Switch between WiFi and mobile data
            <br />
            • Clear browser cache and reload
            <br />
            • Try in private/incognito mode
            <br />
            {/iPad|iPhone|iPod/.test(navigator.userAgent) && (
              <>
                • <strong>iPhone users:</strong> Disable Low Data Mode in Settings → Cellular
                <br />
                • <strong>iPhone users:</strong> Try disabling iCloud Private Relay temporarily
                <br />
              </>
            )}
          </small>
        </div>
      )}

      {/* Debug Info - Only show in development or when there's an error */}
      {debugInfo && error && (
        <details style={{
          background: 'rgba(0,0,0,0.3)',
          borderRadius: '12px',
          padding: '12px',
          marginTop: '16px',
          fontSize: '12px',
          color: 'rgba(255,255,255,0.7)',
        }}>
          <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>
            🔍 Technical Details (for support)
          </summary>
          <pre style={{
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {debugInfo}
          </pre>
        </details>
      )}

      {aadhaarImage && !liveImage && !matchResult && (
        <div>
          <p
            style={{
              textAlign: 'center',
              color: '#10b981',
              marginBottom: 10,
              fontWeight: 600,
              fontSize: '16px',
            }}
          >
            ✅ Aadhaar photo loaded successfully!
          </p>
          <p
            style={{
              textAlign: 'center',
              color: '#a5b4fc',
              marginBottom: 10,
              fontSize: '14px',
            }}
          >
            📹 Starting liveness detection...
          </p>
          <AmplifyLivenessCamera setLiveImage={setLiveImage} />
        </div>
      )}

      {aadhaarImage && liveImage && !matchResult && loading && (
        <div className="card">
          <p
            style={{
              margin: 0,
              fontWeight: 600,
              textAlign: 'center',
              color: '#007bff',
              fontSize: '16px',
            }}
          >
            🔄 Verifying your identity...
          </p>
        </div>
      )}

      {matchResult && <MatchResult result={matchResult} />}
    </div>
  );
}

export default FaceMatcherPage;