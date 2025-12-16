// Replace entire component
const MatchResult = ({ result }) => {
  if (!result) return <div className="card"><p className="placeholder">No comparison done</p></div>;

  return (
    <div className={`card result-card ${!result.matchFound ? 'no-match' : ''}`}>
      <h2 className="title" style={{color: 'white', marginBottom: '1.5rem'}}>🔍 Verification Result</h2>
      
      <div className={`match-badge ${result.matchFound ? 'yes' : 'no'}`}>
        {result.matchFound ? '✅ MATCH CONFIRMED' : '❌ NO MATCH'}
      </div>
      
      <div className="similarity-bar">
        <div 
          className={`similarity-fill ${!result.matchFound ? 'no-match' : ''}`}
          style={{width: `${Math.max(result.similarity || 0, 5)}%`}}
        />
      </div>
      
      <p style={{color: 'white', fontSize: '1.2rem', marginTop: '1rem'}}>
        <strong>Confidence:</strong> <span style={{color: result.matchFound ? '#10b981' : '#ef4444'}}>
          {result.similarity?.toFixed(1) || 0}%
        </span>
      </p>
    </div>
  );
};
export default MatchResult;
