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

  const compareInProgressRef = useRef(false);

  const handleFetch = async () => {
    setError('');

    if (!ppoNumber.trim()) {
      setError('Please enter PPO Number');
      return;
    }

    setLoading(true);

    try {
      const apiUrl =
  `https://nmclivenessdetector.amshoft.in/api/aadhar/getCandidateDetails?ppoNumber=${ppoNumber}`;



      const response = await fetch(apiUrl);
      const data = await response.json();

      if (data.success && data.data?.aadhaarPhotoUrl) {
        let url = data.data.aadhaarPhotoUrl;
        url = url.replace('AadharDoc//', 'AadharDoc/');
        setAadhaarImage(url);
        setLiveImage(null);
        setMatchResult(null);
      } else {
        setError('No Aadhaar photo found for this PPO Number');
      }
    } catch (err) {
      setError('Failed to fetch Aadhaar details');
    }

    setLoading(false);
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

    const formData = new FormData();
    formData.append('aadhaarUrl', aadhaarImage);
    formData.append('image2', liveImage);

    try {
      setLoading(true);

      const response = await fetch(
  `${process.env.REACT_APP_API_BASE_URL}/compare`,
  {
    method: 'POST',
    body: formData,
  }
);


      const data = await response.json();
      setMatchResult(data);
      compareInProgressRef.current = true;
    } catch (err) {
      setError('Comparison failed. Please try again.');
      compareInProgressRef.current = false;
    }

    setLoading(false);
  };

  useEffect(() => {
    if (aadhaarImage && liveImage && !matchResult) {
      setTimeout(() => {
        handleCompare();
      }, 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aadhaarImage, liveImage]);

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
      {loading && !aadhaarImage && <p className="loading">Loading…</p>}

      {/* Error display */}
      {error && <div className="error">{error}</div>}

      {/* Step 2: Liveness Camera (starts automatically after Aadhaar is fetched) */}
      {aadhaarImage && !liveImage && !matchResult && (
        <div>
          <p style={{ textAlign: 'center', color: '#10b981', marginBottom: 10, fontWeight: 600, fontSize: '16px' }}>
            ✅ Aadhaar photo loaded successfully!
          </p>
          <p style={{ textAlign: 'center', color: '#666', marginBottom: 10 }}>
            📹 Starting liveness detection...
          </p>
          <AmplifyLivenessCamera setLiveImage={setLiveImage} />
        </div>
      )}

      {/* Step 3: Auto-comparing message */}
      {aadhaarImage && liveImage && !matchResult && loading && (
        <div className="card">
          <p style={{ margin: 0, fontWeight: 600, textAlign: 'center', color: '#007bff', fontSize: '16px' }}>
            🔄 Verifying your identity...
          </p>
        </div>
      )}

      {/* Step 4: Show Match Result */}
      {matchResult && <MatchResult result={matchResult} />}
    </div>
  );
}

export default FaceMatcherPage;