// Error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // AWS Rekognition specific errors
  if (err.code === 'InvalidImageFormatException') {
    return res.status(400).json({
      success: false,
      error: 'Invalid image format. Please use JPEG or PNG.'
    });
  }

  if (err.code === 'ImageTooLargeException') {
    return res.status(400).json({
      success: false,
      error: 'Image is too large. Maximum size is 5MB.'
    });
  }

  if (err.code === 'InvalidS3ObjectException') {
    return res.status(400).json({
      success: false,
      error: 'Invalid S3 object.'
    });
  }

  if (err.code === 'ResourceAlreadyExistsException') {
    return res.status(409).json({
      success: false,
      error: 'Resource already exists.'
    });
  }

  // Generic error
  res.status(err.statusCode || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
};

module.exports = errorHandler;