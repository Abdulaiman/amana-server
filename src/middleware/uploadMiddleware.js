const multer = require('multer');
const path = require('path');

// Set storage engine
// Set storage engine
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    // Unique filename: fieldname-timestamp.ext
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  },
});

const checkFileType = (file, cb) => {
  const filetypes = /jpeg|jpg|png|pdf/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb('Error: Images/PDF Only!');
  }
};

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    checkFileType(file, cb);
  },
});

module.exports = upload;
