const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadMiddleware');
const cloudinary = require('../utils/cloudinary');

const fs = require('fs');

// Update to support both 'files' (array) and 'image' (single)
router.post('/', upload.fields([{ name: 'files', maxCount: 10 }, { name: 'image', maxCount: 1 }]), async (req, res) => {
  try {
    const files = req.files.files || req.files.image || [];

    if (!files || files.length === 0) {
        return res.status(400).json({ message: 'No files uploaded' });
    }

    const uploadPromises = files.map(file => {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Cloudinary upload timed out after 30s'));
            }, 30000);

            cloudinary.uploader.upload(file.path, { folder: 'amana', resource_type: 'auto' }, (error, result) => {
                clearTimeout(timeout);
                
                // Delete file from server after upload (success or fail)
                try {
                    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                } catch (err) {
                    console.error('Failed to delete local file:', err);
                }

                if (error) {
                    console.error('Cloudinary callback error:', error);
                    reject(new Error(error.message || 'Cloudinary upload failed'));
                } else {
                    resolve(result.secure_url);
                }
            });
        });
    });

    const urls = await Promise.all(uploadPromises);
    
    // Return single URL if it was a single image upload, otherwise return array
    if (req.files.image) {
        res.json({ url: urls[0] });
    } else {
        res.json(urls);
    }
  } catch (error) {
     console.error('Cloudinary Upload Error:', error);
     // Clean up any remaining files if main process fails
     if (req.files) {
         Object.values(req.files).flat().forEach(file => {
             if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
         });
     }
    res.status(500).json({ message: error.message || 'Upload failed' });
  }
});

module.exports = router;
