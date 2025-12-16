import React, { useState } from 'react';

const AadhaarPhoto = ({ imageUrl }) => {
  const [loading, setLoading] = useState(true);
  const [errorImg, setErrorImg] = useState(false);

  return (
    <div className="card">
      <h2 className="title">Aadhaar Photo</h2>

      {!imageUrl && <p className="placeholder">No image loaded yet</p>}

      {imageUrl && (
        <div style={{ textAlign: 'center' }}>
          {loading && <p>Loading image...</p>}

          <img
            src={errorImg ? '/fallback.png' : imageUrl}
            alt="aadhaar"
            className="preview-img"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setErrorImg(true);
            }}
            style={{ display: loading ? 'none' : 'block' }}
          />
        </div>
      )}
    </div>
  );
};

export default AadhaarPhoto;