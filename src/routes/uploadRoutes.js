const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadMiddleware');
const cloudinary = require('../utils/cloudinary');
const fs = require('fs');

router.post('/', upload.array('files', 10), async (req, res) => {
  try {
    const urls = [];
    const files = req.files;

    if (!files || files.length === 0) {
        return res.status(400).json({ message: 'No files uploaded' });
    }

    for (const file of files) {
        const result = await cloudinary.uploader.upload(file.path, {
            folder: 'amana',
        });
        
        // Clean up local file
        fs.unlinkSync(file.path);
        urls.push(result.secure_url);
    }

    res.json(urls);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Upload failed' });
  }
});

module.exports = router;
