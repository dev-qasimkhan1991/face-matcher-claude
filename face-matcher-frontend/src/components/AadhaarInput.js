import '../styles.css';

import React from 'react';

const AadhaarInput = ({ ppoNumber, setPpoNumber, handleFetch }) => {
  return (
    <div className="card">
      <h2 className="title">Fetch Aadhaar Image</h2>
      <div className="input-row">
        <input
          type="text"
          className="input"
          value={ppoNumber}
          onChange={(e) => setPpoNumber(e.target.value)}
          placeholder="Enter PPO Number"
        />
        <button className="btn" onClick={handleFetch}>
          Get Photo
        </button>
      </div>
    </div>
  );
};

export default AadhaarInput;