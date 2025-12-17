const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadMiddleware');
const cloudinary = require('../utils/cloudinary');


const stream = require('stream');

const uploadFromBuffer = (fileBuffer) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: 'amana' },
            (error, result) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            }
        );
        const bufferStream = new stream.PassThrough();
        bufferStream.end(fileBuffer);
        bufferStream.pipe(uploadStream);
    });
};

router.post('/', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files;

    if (!files || files.length === 0) {
        return res.status(400).json({ message: 'No files uploaded' });
    }

    const uploadPromises = files.map(file => uploadFromBuffer(file.buffer));
    const results = await Promise.all(uploadPromises);
    const urls = results.map(result => result.secure_url);

    res.json(urls);
  } catch (error) {
     console.error('Cloudinary Upload Error:', error);
    res.status(500).json({ message: 'Upload failed' });
  }
});

module.exports = router;
