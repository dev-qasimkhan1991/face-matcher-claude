import axios from 'axios';

// Your backend (face compare, liveness)
const API = axios.create({
  baseURL: 'http://localhost:3001',
});

// External Aadhaar backend (IMPORTANT)
const AADHAAR_BASE_URL =
  'https://testingpcmcpensioner.altwise.in';

export const fetchAadhaarByPPO = (ppoNumber) => {
  console.log('🔥 Aadhaar API called with PPO:', ppoNumber);

  return axios.get(
    `${AADHAAR_BASE_URL}/api/aadhar/getCandidateDetails`,
    {
      params: { ppoNumber },
    }
  );
};

export const compareFaces = (formData) =>
  API.post('/compare', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

export const compareImages = (formData) =>
  API.post('/compare-images', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

export default API;
