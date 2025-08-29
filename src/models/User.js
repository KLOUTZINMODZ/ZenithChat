const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  avatar: {
    type: String,
    default: null
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  preferences: {
    notifications: {
      type: Boolean,
      default: true
    },
    sound: {
      type: Boolean,
      default: true
    }
  }
}, {
  timestamps: true
});


userSchema.index({ email: 1 });


userSchema.virtual('displayName').get(function() {
  return this.name || this.email.split('@')[0];
});


userSchema.methods.updateLastSeen = function() {
  this.lastSeen = new Date();
  return this.save();
};


userSchema.methods.setOnlineStatus = function(isOnline) {
  this.isOnline = isOnline;
  if (!isOnline) {
    this.lastSeen = new Date();
  }
  return this.save();
};

module.exports = mongoose.model('User', userSchema);
