const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 30
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: true,
      select: false
    },
    bio: { type: String, trim: true, maxlength: 240, default: "" },
    avatarUrl: { type: String, trim: true, maxlength: 500, default: "" },
    location: { type: String, trim: true, maxlength: 80, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);