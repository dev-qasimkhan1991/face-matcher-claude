import '../styles.css';

import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import AadhaarInput from './AadhaarInput';
import AadhaarPhoto from './AadhaarPhoto';
import AmplifyLivenessCamera from './AmplifyLivenessCamera';
import MatchResult from './MatchResult';

function FaceMatcherPage() {
  const [ppoNumber, setPpoNumber] = useState('');
  const [aadhaarImage, setAadhaarImage] = useState(null);
  const [liveImage, setLiveImage] = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 🔧 PATCH 3: prevents duplicate compare
  const compareInProgressRef = useRef(false);

  const handleFetch = async () => {
    console.log('[FaceMatcherPage] 🔵 START: Fetching Aadhaar for PPO:', ppoNumber);
    setError('');

    if (!ppoNumber.trim()) {
      console.warn('[FaceMatcherPage] ⚠️ PPO number is empty');
      setError('Please enter PPO Number');
      return;
    }

    setLoading(true);

    try {
      const apiUrl = `/api/aadhar/getCandidateDetails?ppoNumber=${ppoNumber}`;
      console.log('[FaceMatcherPage] 🔵 Fetching from:', apiUrl);

      const response = await fetch(apiUrl);
      console.log('[FaceMatcherPage] 🔵 API response status:', response.status);

      const data = await response.json();
      console.log('[FaceMatcherPage] 🔵 API response data:', JSON.stringify(data, null, 2));

      if (data.success && data.data?.aadhaarPhotoUrl) {
        let url = data.data.aadhaarPhotoUrl;
        console.log('[FaceMatcherPage] 🔵 Original Aadhaar URL:', url);

        // Fix double slashes if needed
        url = url.replace('AadharDoc//', 'AadharDoc/');
        console.log('[FaceMatcherPage] 🟢 Final Aadhaar URL:', url);

        setAadhaarImage(url);

        // Reset previous state
        console.log('[FaceMatcherPage] 🔵 Resetting liveImage and matchResult');
        setLiveImage(null);
        setMatchResult(null);
      } else {
        console.error('[FaceMatcherPage] 🔴 No Aadhaar photo in response');
        setError('No Aadhaar photo found for this PPO Number');
      }
    } catch (err) {
      console.error('[FaceMatcherPage] 🔴 ERROR fetching Aadhaar:', err);
      console.error('[FaceMatcherPage] 🔴 Error stack:', err.stack);
      setError('Failed to fetch Aadhaar details');
    }

    setLoading(false);
  };

  const handleCompare = async () => {
    // 🔧 PATCH 3: Modify handleCompare() — TOP OF FUNCTION
    if (compareInProgressRef.current) {
      console.warn('[PATCH] Compare already in progress, blocked');
      return;
    }

    compareInProgressRef.current = true;
    
    console.log('[FaceMatcherPage] 🟡 ===== STARTING COMPARISON =====');
    console.log('[FaceMatcherPage] 🟡 Comparison state:', {
      hasAadhaarImage: !!aadhaarImage,
      hasLiveImage: !!liveImage,
      aadhaarImageUrl: aadhaarImage,
      liveImageType: liveImage?.type,
      liveImageSize: liveImage?.size,
      liveImageName: liveImage?.name,
    });

    if (!aadhaarImage || !liveImage) {
      console.warn('[FaceMatcherPage] ⚠️ Missing images for comparison');
      compareInProgressRef.current = false;
      return;
    }

    const formData = new FormData();
    formData.append('aadhaarUrl', aadhaarImage);
    formData.append('image2', liveImage);

    console.log('[FaceMatcherPage] 🔵 FormData prepared:', {
      aadhaarUrl: aadhaarImage,
      image2Name: liveImage.name,
      image2Size: liveImage.size,
    });

    try {
      setLoading(true);
      console.log('[FaceMatcherPage] 🔵 Sending comparison request to backend...');

      const response = await fetch('http://localhost:3000/compare', {
        method: 'POST',
        body: formData,
      });

      console.log('[FaceMatcherPage] 🔵 Comparison response status:', response.status);

      const data = await response.json();
      console.log('[FaceMatcherPage] 🟢 Comparison result:', JSON.stringify(data, null, 2));

      setMatchResult(data);

      // 🔧 PATCH 4: After successful compare — lock permanently
      compareInProgressRef.current = true;

      if (data.matchFound) {
        console.log('[FaceMatcherPage] 🟢 ✓ MATCH FOUND! Similarity:', data.similarity);
      } else {
        console.log('[FaceMatcherPage] 🔴 ✗ NO MATCH. Similarity:', data.similarity);
      }
    } catch (err) {
      console.error('[FaceMatcherPage] 🔴 ERROR during comparison:', err);
      console.error('[FaceMatcherPage] 🔴 Error stack:', err.stack);
      setError('Comparison failed. Please try again.');
      // 🔧 PATCH 3: On compare failure — allow retry
      compareInProgressRef.current = false;
    }

    setLoading(false);
    console.log('[FaceMatcherPage] 🟡 ===== COMPARISON COMPLETE =====');
  };

  // Auto-compare when both Aadhaar image and live image are available
  useEffect(() => {
    console.log('[FaceMatcherPage] 🔵 useEffect triggered - checking auto-compare conditions');
    console.log('[FaceMatcherPage] 🔵 State:', {
      hasAadhaarImage: !!aadhaarImage,
      hasLiveImage: !!liveImage,
      hasMatchResult: !!matchResult,
    });

    if (aadhaarImage && liveImage && !matchResult) {
      console.log('[FaceMatcherPage] 🟢 Auto-compare conditions met! Starting comparison...');
      // 🔧 PATCH 5: Add delay to auto-compare effect
      setTimeout(() => {
        handleCompare();
      }, 400);
    } else {
      console.log('[FaceMatcherPage] 🟡 Auto-compare skipped:', {
        reason: !aadhaarImage ? 'No Aadhaar image' : !liveImage ? 'No live image' : 'Already have result'
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aadhaarImage, liveImage]);

  // Log state changes
  useEffect(() => {
    console.log('[FaceMatcherPage] 🔵 liveImage state changed:', {
      hasLiveImage: !!liveImage,
      liveImageType: liveImage?.type,
      liveImageSize: liveImage?.size,
    });
  }, [liveImage]);

  useEffect(() => {
    console.log('[FaceMatcherPage] 🔵 aadhaarImage state changed:', aadhaarImage);
  }, [aadhaarImage]);

  useEffect(() => {
    console.log('[FaceMatcherPage] 🔵 matchResult state changed:', matchResult);
  }, [matchResult]);

  console.log('[FaceMatcherPage] 🔵 Render - Current state:', {
    ppoNumber,
    hasAadhaarImage: !!aadhaarImage,
    hasLiveImage: !!liveImage,
    hasMatchResult: !!matchResult,
    loading,
    error,
  });

  return (
    <div className="container">
      <h1 className="main-title">AI Face Verification Pro</h1>

      {/* Step 1: Input PPO Number */}
      <AadhaarInput
        ppoNumber={ppoNumber}
        setPpoNumber={setPpoNumber}
        handleFetch={handleFetch}
      />

      {/* Loading indicator */}
      {loading && <p className="loading">Loading…</p>}

      {/* Error display */}
      {error && <div className="error">{error}</div>}

      {/* Step 2: Show Aadhaar Photo */}
      {aadhaarImage && <AadhaarPhoto imageUrl={aadhaarImage} />}

      {/* Step 3: Liveness Camera (only after Aadhaar image is loaded) */}
      {aadhaarImage && !liveImage && (
        <div>
          <p style={{ textAlign: 'center', color: '#666', marginBottom: 10 }}>
            📹 Starting liveness detection...
          </p>
          <AmplifyLivenessCamera setLiveImage={setLiveImage} />
        </div>
      )}

      {/* Step 4: Auto-comparing message */}
      {aadhaarImage && liveImage && !matchResult && loading && (
        <div className="card">
          <p style={{ margin: 0, fontWeight: 600, textAlign: 'center', color: '#007bff' }}>
            🔄 Auto-comparing captured photo with Aadhaar image...
          </p>
        </div>
      )}

      {/* Step 5: Show Match Result */}
      {matchResult && <MatchResult result={matchResult} />}

      {/* Debug Info (remove in production) */}
      {process.env.NODE_ENV === 'development' && (
  <div className="card debug-panel">
    <h3 style={{color: '#a5b4fc', marginBottom: '1rem'}}>🔧 Debug Console</h3>
    <pre>{JSON.stringify({ppoNumber, hasAadhaarImage: !!aadhaarImage, hasLiveImage: !!liveImage, matchResult}, null, 2)}</pre>
  </div>
)}
    </div>
  );
}

export default FaceMatcherPage;
