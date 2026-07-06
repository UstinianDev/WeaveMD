"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const require$$1 = require("crypto");
const require$$0 = require("buffer");
const require$$3 = require("stream");
const require$$5 = require("util");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const isDev = process.env.NODE_ENV === "development" || !electron.app.isPackaged;
let mainWindow = null;
function createMainWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: "#0F0F0F",
    show: false,
    title: "WeaveMD",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist-render/index.html"));
  }
  mainWindow.once("ready-to-show", () => {
    mainWindow == null ? void 0 : mainWindow.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  return mainWindow;
}
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var jws$3 = {};
var safeBuffer = { exports: {} };
/*! safe-buffer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
(function(module, exports) {
  var buffer = require$$0;
  var Buffer2 = buffer.Buffer;
  function copyProps(src, dst) {
    for (var key in src) {
      dst[key] = src[key];
    }
  }
  if (Buffer2.from && Buffer2.alloc && Buffer2.allocUnsafe && Buffer2.allocUnsafeSlow) {
    module.exports = buffer;
  } else {
    copyProps(buffer, exports);
    exports.Buffer = SafeBuffer;
  }
  function SafeBuffer(arg, encodingOrOffset, length) {
    return Buffer2(arg, encodingOrOffset, length);
  }
  SafeBuffer.prototype = Object.create(Buffer2.prototype);
  copyProps(Buffer2, SafeBuffer);
  SafeBuffer.from = function(arg, encodingOrOffset, length) {
    if (typeof arg === "number") {
      throw new TypeError("Argument must not be a number");
    }
    return Buffer2(arg, encodingOrOffset, length);
  };
  SafeBuffer.alloc = function(size, fill, encoding) {
    if (typeof size !== "number") {
      throw new TypeError("Argument must be a number");
    }
    var buf = Buffer2(size);
    if (fill !== void 0) {
      if (typeof encoding === "string") {
        buf.fill(fill, encoding);
      } else {
        buf.fill(fill);
      }
    } else {
      buf.fill(0);
    }
    return buf;
  };
  SafeBuffer.allocUnsafe = function(size) {
    if (typeof size !== "number") {
      throw new TypeError("Argument must be a number");
    }
    return Buffer2(size);
  };
  SafeBuffer.allocUnsafeSlow = function(size) {
    if (typeof size !== "number") {
      throw new TypeError("Argument must be a number");
    }
    return buffer.SlowBuffer(size);
  };
})(safeBuffer, safeBuffer.exports);
var safeBufferExports = safeBuffer.exports;
var Buffer$6 = safeBufferExports.Buffer;
var Stream$2 = require$$3;
var util$3 = require$$5;
function DataStream$2(data) {
  this.buffer = null;
  this.writable = true;
  this.readable = true;
  if (!data) {
    this.buffer = Buffer$6.alloc(0);
    return this;
  }
  if (typeof data.pipe === "function") {
    this.buffer = Buffer$6.alloc(0);
    data.pipe(this);
    return this;
  }
  if (data.length || typeof data === "object") {
    this.buffer = data;
    this.writable = false;
    process.nextTick((function() {
      this.emit("end", data);
      this.readable = false;
      this.emit("close");
    }).bind(this));
    return this;
  }
  throw new TypeError("Unexpected data type (" + typeof data + ")");
}
util$3.inherits(DataStream$2, Stream$2);
DataStream$2.prototype.write = function write(data) {
  this.buffer = Buffer$6.concat([this.buffer, Buffer$6.from(data)]);
  this.emit("data", data);
};
DataStream$2.prototype.end = function end(data) {
  if (data)
    this.write(data);
  this.emit("end", data);
  this.emit("close");
  this.writable = false;
  this.readable = false;
};
var dataStream = DataStream$2;
function getParamSize(keySize) {
  var result = (keySize / 8 | 0) + (keySize % 8 === 0 ? 0 : 1);
  return result;
}
var paramBytesForAlg = {
  ES256: getParamSize(256),
  ES384: getParamSize(384),
  ES512: getParamSize(521)
};
function getParamBytesForAlg$1(alg) {
  var paramBytes = paramBytesForAlg[alg];
  if (paramBytes) {
    return paramBytes;
  }
  throw new Error('Unknown algorithm "' + alg + '"');
}
var paramBytesForAlg_1 = getParamBytesForAlg$1;
var Buffer$5 = safeBufferExports.Buffer;
var getParamBytesForAlg = paramBytesForAlg_1;
var MAX_OCTET = 128, CLASS_UNIVERSAL = 0, PRIMITIVE_BIT = 32, TAG_SEQ = 16, TAG_INT = 2, ENCODED_TAG_SEQ = TAG_SEQ | PRIMITIVE_BIT | CLASS_UNIVERSAL << 6, ENCODED_TAG_INT = TAG_INT | CLASS_UNIVERSAL << 6;
function base64Url(base64) {
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function signatureAsBuffer(signature) {
  if (Buffer$5.isBuffer(signature)) {
    return signature;
  } else if ("string" === typeof signature) {
    return Buffer$5.from(signature, "base64");
  }
  throw new TypeError("ECDSA signature must be a Base64 string or a Buffer");
}
function derToJose(signature, alg) {
  signature = signatureAsBuffer(signature);
  var paramBytes = getParamBytesForAlg(alg);
  var maxEncodedParamLength = paramBytes + 1;
  var inputLength = signature.length;
  var offset = 0;
  if (signature[offset++] !== ENCODED_TAG_SEQ) {
    throw new Error('Could not find expected "seq"');
  }
  var seqLength = signature[offset++];
  if (seqLength === (MAX_OCTET | 1)) {
    seqLength = signature[offset++];
  }
  if (inputLength - offset < seqLength) {
    throw new Error('"seq" specified length of "' + seqLength + '", only "' + (inputLength - offset) + '" remaining');
  }
  if (signature[offset++] !== ENCODED_TAG_INT) {
    throw new Error('Could not find expected "int" for "r"');
  }
  var rLength = signature[offset++];
  if (inputLength - offset - 2 < rLength) {
    throw new Error('"r" specified length of "' + rLength + '", only "' + (inputLength - offset - 2) + '" available');
  }
  if (maxEncodedParamLength < rLength) {
    throw new Error('"r" specified length of "' + rLength + '", max of "' + maxEncodedParamLength + '" is acceptable');
  }
  var rOffset = offset;
  offset += rLength;
  if (signature[offset++] !== ENCODED_TAG_INT) {
    throw new Error('Could not find expected "int" for "s"');
  }
  var sLength = signature[offset++];
  if (inputLength - offset !== sLength) {
    throw new Error('"s" specified length of "' + sLength + '", expected "' + (inputLength - offset) + '"');
  }
  if (maxEncodedParamLength < sLength) {
    throw new Error('"s" specified length of "' + sLength + '", max of "' + maxEncodedParamLength + '" is acceptable');
  }
  var sOffset = offset;
  offset += sLength;
  if (offset !== inputLength) {
    throw new Error('Expected to consume entire buffer, but "' + (inputLength - offset) + '" bytes remain');
  }
  var rPadding = paramBytes - rLength, sPadding = paramBytes - sLength;
  var dst = Buffer$5.allocUnsafe(rPadding + rLength + sPadding + sLength);
  for (offset = 0; offset < rPadding; ++offset) {
    dst[offset] = 0;
  }
  signature.copy(dst, offset, rOffset + Math.max(-rPadding, 0), rOffset + rLength);
  offset = paramBytes;
  for (var o = offset; offset < o + sPadding; ++offset) {
    dst[offset] = 0;
  }
  signature.copy(dst, offset, sOffset + Math.max(-sPadding, 0), sOffset + sLength);
  dst = dst.toString("base64");
  dst = base64Url(dst);
  return dst;
}
function countPadding(buf, start, stop) {
  var padding = 0;
  while (start + padding < stop && buf[start + padding] === 0) {
    ++padding;
  }
  var needsSign = buf[start + padding] >= MAX_OCTET;
  if (needsSign) {
    --padding;
  }
  return padding;
}
function joseToDer(signature, alg) {
  signature = signatureAsBuffer(signature);
  var paramBytes = getParamBytesForAlg(alg);
  var signatureBytes = signature.length;
  if (signatureBytes !== paramBytes * 2) {
    throw new TypeError('"' + alg + '" signatures must be "' + paramBytes * 2 + '" bytes, saw "' + signatureBytes + '"');
  }
  var rPadding = countPadding(signature, 0, paramBytes);
  var sPadding = countPadding(signature, paramBytes, signature.length);
  var rLength = paramBytes - rPadding;
  var sLength = paramBytes - sPadding;
  var rsBytes = 1 + 1 + rLength + 1 + 1 + sLength;
  var shortLength = rsBytes < MAX_OCTET;
  var dst = Buffer$5.allocUnsafe((shortLength ? 2 : 3) + rsBytes);
  var offset = 0;
  dst[offset++] = ENCODED_TAG_SEQ;
  if (shortLength) {
    dst[offset++] = rsBytes;
  } else {
    dst[offset++] = MAX_OCTET | 1;
    dst[offset++] = rsBytes & 255;
  }
  dst[offset++] = ENCODED_TAG_INT;
  dst[offset++] = rLength;
  if (rPadding < 0) {
    dst[offset++] = 0;
    offset += signature.copy(dst, offset, 0, paramBytes);
  } else {
    offset += signature.copy(dst, offset, rPadding, paramBytes);
  }
  dst[offset++] = ENCODED_TAG_INT;
  dst[offset++] = sLength;
  if (sPadding < 0) {
    dst[offset++] = 0;
    signature.copy(dst, offset, paramBytes);
  } else {
    signature.copy(dst, offset, paramBytes + sPadding);
  }
  return dst;
}
var ecdsaSigFormatter = {
  derToJose,
  joseToDer
};
var bufferEqualConstantTime;
var hasRequiredBufferEqualConstantTime;
function requireBufferEqualConstantTime() {
  if (hasRequiredBufferEqualConstantTime) return bufferEqualConstantTime;
  hasRequiredBufferEqualConstantTime = 1;
  var Buffer2 = require$$0.Buffer;
  var SlowBuffer = require$$0.SlowBuffer;
  bufferEqualConstantTime = bufferEq;
  function bufferEq(a, b) {
    if (!Buffer2.isBuffer(a) || !Buffer2.isBuffer(b)) {
      return false;
    }
    if (a.length !== b.length) {
      return false;
    }
    var c = 0;
    for (var i = 0; i < a.length; i++) {
      c |= a[i] ^ b[i];
    }
    return c === 0;
  }
  bufferEq.install = function() {
    Buffer2.prototype.equal = SlowBuffer.prototype.equal = function equal(that) {
      return bufferEq(this, that);
    };
  };
  var origBufEqual = Buffer2.prototype.equal;
  var origSlowBufEqual = SlowBuffer.prototype.equal;
  bufferEq.restore = function() {
    Buffer2.prototype.equal = origBufEqual;
    SlowBuffer.prototype.equal = origSlowBufEqual;
  };
  return bufferEqualConstantTime;
}
var Buffer$4 = safeBufferExports.Buffer;
var crypto = require$$1;
var formatEcdsa = ecdsaSigFormatter;
var util$2 = require$$5;
var MSG_INVALID_ALGORITHM = '"%s" is not a valid algorithm.\n  Supported algorithms are:\n  "HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512" and "none".';
var MSG_INVALID_SECRET = "secret must be a string or buffer";
var MSG_INVALID_VERIFIER_KEY = "key must be a string or a buffer";
var MSG_INVALID_SIGNER_KEY = "key must be a string, a buffer or an object";
var supportsKeyObjects = typeof crypto.createPublicKey === "function";
if (supportsKeyObjects) {
  MSG_INVALID_VERIFIER_KEY += " or a KeyObject";
  MSG_INVALID_SECRET += "or a KeyObject";
}
function checkIsPublicKey(key) {
  if (Buffer$4.isBuffer(key)) {
    return;
  }
  if (typeof key === "string") {
    return;
  }
  if (!supportsKeyObjects) {
    throw typeError(MSG_INVALID_VERIFIER_KEY);
  }
  if (typeof key !== "object") {
    throw typeError(MSG_INVALID_VERIFIER_KEY);
  }
  if (typeof key.type !== "string") {
    throw typeError(MSG_INVALID_VERIFIER_KEY);
  }
  if (typeof key.asymmetricKeyType !== "string") {
    throw typeError(MSG_INVALID_VERIFIER_KEY);
  }
  if (typeof key.export !== "function") {
    throw typeError(MSG_INVALID_VERIFIER_KEY);
  }
}
function checkIsPrivateKey(key) {
  if (Buffer$4.isBuffer(key)) {
    return;
  }
  if (typeof key === "string") {
    return;
  }
  if (typeof key === "object") {
    return;
  }
  throw typeError(MSG_INVALID_SIGNER_KEY);
}
function checkIsSecretKey(key) {
  if (Buffer$4.isBuffer(key)) {
    return;
  }
  if (typeof key === "string") {
    return key;
  }
  if (!supportsKeyObjects) {
    throw typeError(MSG_INVALID_SECRET);
  }
  if (typeof key !== "object") {
    throw typeError(MSG_INVALID_SECRET);
  }
  if (key.type !== "secret") {
    throw typeError(MSG_INVALID_SECRET);
  }
  if (typeof key.export !== "function") {
    throw typeError(MSG_INVALID_SECRET);
  }
}
function fromBase64(base64) {
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function toBase64(base64url2) {
  base64url2 = base64url2.toString();
  var padding = 4 - base64url2.length % 4;
  if (padding !== 4) {
    for (var i = 0; i < padding; ++i) {
      base64url2 += "=";
    }
  }
  return base64url2.replace(/\-/g, "+").replace(/_/g, "/");
}
function typeError(template) {
  var args = [].slice.call(arguments, 1);
  var errMsg = util$2.format.bind(util$2, template).apply(null, args);
  return new TypeError(errMsg);
}
function bufferOrString(obj) {
  return Buffer$4.isBuffer(obj) || typeof obj === "string";
}
function normalizeInput(thing) {
  if (!bufferOrString(thing))
    thing = JSON.stringify(thing);
  return thing;
}
function createHmacSigner(bits) {
  return function sign3(thing, secret) {
    checkIsSecretKey(secret);
    thing = normalizeInput(thing);
    var hmac = crypto.createHmac("sha" + bits, secret);
    var sig = (hmac.update(thing), hmac.digest("base64"));
    return fromBase64(sig);
  };
}
var bufferEqual;
var timingSafeEqual = "timingSafeEqual" in crypto ? function timingSafeEqual2(a, b) {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
} : function timingSafeEqual3(a, b) {
  if (!bufferEqual) {
    bufferEqual = requireBufferEqualConstantTime();
  }
  return bufferEqual(a, b);
};
function createHmacVerifier(bits) {
  return function verify3(thing, signature, secret) {
    var computedSig = createHmacSigner(bits)(thing, secret);
    return timingSafeEqual(Buffer$4.from(signature), Buffer$4.from(computedSig));
  };
}
function createKeySigner(bits) {
  return function sign3(thing, privateKey) {
    checkIsPrivateKey(privateKey);
    thing = normalizeInput(thing);
    var signer = crypto.createSign("RSA-SHA" + bits);
    var sig = (signer.update(thing), signer.sign(privateKey, "base64"));
    return fromBase64(sig);
  };
}
function createKeyVerifier(bits) {
  return function verify3(thing, signature, publicKey) {
    checkIsPublicKey(publicKey);
    thing = normalizeInput(thing);
    signature = toBase64(signature);
    var verifier = crypto.createVerify("RSA-SHA" + bits);
    verifier.update(thing);
    return verifier.verify(publicKey, signature, "base64");
  };
}
function createPSSKeySigner(bits) {
  return function sign3(thing, privateKey) {
    checkIsPrivateKey(privateKey);
    thing = normalizeInput(thing);
    var signer = crypto.createSign("RSA-SHA" + bits);
    var sig = (signer.update(thing), signer.sign({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
    }, "base64"));
    return fromBase64(sig);
  };
}
function createPSSKeyVerifier(bits) {
  return function verify3(thing, signature, publicKey) {
    checkIsPublicKey(publicKey);
    thing = normalizeInput(thing);
    signature = toBase64(signature);
    var verifier = crypto.createVerify("RSA-SHA" + bits);
    verifier.update(thing);
    return verifier.verify({
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
    }, signature, "base64");
  };
}
function createECDSASigner(bits) {
  var inner = createKeySigner(bits);
  return function sign3() {
    var signature = inner.apply(null, arguments);
    signature = formatEcdsa.derToJose(signature, "ES" + bits);
    return signature;
  };
}
function createECDSAVerifer(bits) {
  var inner = createKeyVerifier(bits);
  return function verify3(thing, signature, publicKey) {
    signature = formatEcdsa.joseToDer(signature, "ES" + bits).toString("base64");
    var result = inner(thing, signature, publicKey);
    return result;
  };
}
function createNoneSigner() {
  return function sign3() {
    return "";
  };
}
function createNoneVerifier() {
  return function verify3(thing, signature) {
    return signature === "";
  };
}
var jwa$2 = function jwa(algorithm) {
  var signerFactories = {
    hs: createHmacSigner,
    rs: createKeySigner,
    ps: createPSSKeySigner,
    es: createECDSASigner,
    none: createNoneSigner
  };
  var verifierFactories = {
    hs: createHmacVerifier,
    rs: createKeyVerifier,
    ps: createPSSKeyVerifier,
    es: createECDSAVerifer,
    none: createNoneVerifier
  };
  var match = algorithm.match(/^(RS|PS|ES|HS)(256|384|512)$|^(none)$/);
  if (!match)
    throw typeError(MSG_INVALID_ALGORITHM, algorithm);
  var algo = (match[1] || match[3]).toLowerCase();
  var bits = match[2];
  return {
    sign: signerFactories[algo](bits),
    verify: verifierFactories[algo](bits)
  };
};
var Buffer$3 = require$$0.Buffer;
var tostring = function toString(obj) {
  if (typeof obj === "string")
    return obj;
  if (typeof obj === "number" || Buffer$3.isBuffer(obj))
    return obj.toString();
  return JSON.stringify(obj);
};
var Buffer$2 = safeBufferExports.Buffer;
var DataStream$1 = dataStream;
var jwa$1 = jwa$2;
var Stream$1 = require$$3;
var toString$1 = tostring;
var util$1 = require$$5;
function base64url(string, encoding) {
  return Buffer$2.from(string, encoding).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function jwsSecuredInput(header, payload, encoding) {
  encoding = encoding || "utf8";
  var encodedHeader = base64url(toString$1(header), "binary");
  var encodedPayload = base64url(toString$1(payload), encoding);
  return util$1.format("%s.%s", encodedHeader, encodedPayload);
}
function jwsSign(opts) {
  var header = opts.header;
  var payload = opts.payload;
  var secretOrKey = opts.secret || opts.privateKey;
  var encoding = opts.encoding;
  var algo = jwa$1(header.alg);
  var securedInput = jwsSecuredInput(header, payload, encoding);
  var signature = algo.sign(securedInput, secretOrKey);
  return util$1.format("%s.%s", securedInput, signature);
}
function SignStream$1(opts) {
  var secret = opts.secret;
  secret = secret == null ? opts.privateKey : secret;
  secret = secret == null ? opts.key : secret;
  if (/^hs/i.test(opts.header.alg) === true && secret == null) {
    throw new TypeError("secret must be a string or buffer or a KeyObject");
  }
  var secretStream = new DataStream$1(secret);
  this.readable = true;
  this.header = opts.header;
  this.encoding = opts.encoding;
  this.secret = this.privateKey = this.key = secretStream;
  this.payload = new DataStream$1(opts.payload);
  this.secret.once("close", (function() {
    if (!this.payload.writable && this.readable)
      this.sign();
  }).bind(this));
  this.payload.once("close", (function() {
    if (!this.secret.writable && this.readable)
      this.sign();
  }).bind(this));
}
util$1.inherits(SignStream$1, Stream$1);
SignStream$1.prototype.sign = function sign() {
  try {
    var signature = jwsSign({
      header: this.header,
      payload: this.payload.buffer,
      secret: this.secret.buffer,
      encoding: this.encoding
    });
    this.emit("done", signature);
    this.emit("data", signature);
    this.emit("end");
    this.readable = false;
    return signature;
  } catch (e) {
    this.readable = false;
    this.emit("error", e);
    this.emit("close");
  }
};
SignStream$1.sign = jwsSign;
var signStream = SignStream$1;
var Buffer$1 = safeBufferExports.Buffer;
var DataStream = dataStream;
var jwa2 = jwa$2;
var Stream = require$$3;
var toString2 = tostring;
var util = require$$5;
var JWS_REGEX = /^[a-zA-Z0-9\-_]+?\.[a-zA-Z0-9\-_]+?\.([a-zA-Z0-9\-_]+)?$/;
function isObject$3(thing) {
  return Object.prototype.toString.call(thing) === "[object Object]";
}
function safeJsonParse(thing) {
  if (isObject$3(thing))
    return thing;
  try {
    return JSON.parse(thing);
  } catch (e) {
    return void 0;
  }
}
function headerFromJWS(jwsSig) {
  var encodedHeader = jwsSig.split(".", 1)[0];
  return safeJsonParse(Buffer$1.from(encodedHeader, "base64").toString("binary"));
}
function securedInputFromJWS(jwsSig) {
  return jwsSig.split(".", 2).join(".");
}
function signatureFromJWS(jwsSig) {
  return jwsSig.split(".")[2];
}
function payloadFromJWS(jwsSig, encoding) {
  encoding = encoding || "utf8";
  var payload = jwsSig.split(".")[1];
  return Buffer$1.from(payload, "base64").toString(encoding);
}
function isValidJws(string) {
  return JWS_REGEX.test(string) && !!headerFromJWS(string);
}
function jwsVerify(jwsSig, algorithm, secretOrKey) {
  if (!algorithm) {
    var err = new Error("Missing algorithm parameter for jws.verify");
    err.code = "MISSING_ALGORITHM";
    throw err;
  }
  jwsSig = toString2(jwsSig);
  var signature = signatureFromJWS(jwsSig);
  var securedInput = securedInputFromJWS(jwsSig);
  var algo = jwa2(algorithm);
  return algo.verify(securedInput, signature, secretOrKey);
}
function jwsDecode(jwsSig, opts) {
  opts = opts || {};
  jwsSig = toString2(jwsSig);
  if (!isValidJws(jwsSig))
    return null;
  var header = headerFromJWS(jwsSig);
  if (!header)
    return null;
  var payload = payloadFromJWS(jwsSig);
  if (header.typ === "JWT" || opts.json)
    payload = JSON.parse(payload, opts.encoding);
  return {
    header,
    payload,
    signature: signatureFromJWS(jwsSig)
  };
}
function VerifyStream$1(opts) {
  opts = opts || {};
  var secretOrKey = opts.secret;
  secretOrKey = secretOrKey == null ? opts.publicKey : secretOrKey;
  secretOrKey = secretOrKey == null ? opts.key : secretOrKey;
  if (/^hs/i.test(opts.algorithm) === true && secretOrKey == null) {
    throw new TypeError("secret must be a string or buffer or a KeyObject");
  }
  var secretStream = new DataStream(secretOrKey);
  this.readable = true;
  this.algorithm = opts.algorithm;
  this.encoding = opts.encoding;
  this.secret = this.publicKey = this.key = secretStream;
  this.signature = new DataStream(opts.signature);
  this.secret.once("close", (function() {
    if (!this.signature.writable && this.readable)
      this.verify();
  }).bind(this));
  this.signature.once("close", (function() {
    if (!this.secret.writable && this.readable)
      this.verify();
  }).bind(this));
}
util.inherits(VerifyStream$1, Stream);
VerifyStream$1.prototype.verify = function verify() {
  try {
    var valid2 = jwsVerify(this.signature.buffer, this.algorithm, this.key.buffer);
    var obj = jwsDecode(this.signature.buffer, this.encoding);
    this.emit("done", valid2, obj);
    this.emit("data", valid2);
    this.emit("end");
    this.readable = false;
    return valid2;
  } catch (e) {
    this.readable = false;
    this.emit("error", e);
    this.emit("close");
  }
};
VerifyStream$1.decode = jwsDecode;
VerifyStream$1.isValid = isValidJws;
VerifyStream$1.verify = jwsVerify;
var verifyStream = VerifyStream$1;
var SignStream = signStream;
var VerifyStream = verifyStream;
var ALGORITHMS = [
  "HS256",
  "HS384",
  "HS512",
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512"
];
jws$3.ALGORITHMS = ALGORITHMS;
jws$3.sign = SignStream.sign;
jws$3.verify = VerifyStream.verify;
jws$3.decode = VerifyStream.decode;
jws$3.isValid = VerifyStream.isValid;
jws$3.createSign = function createSign(opts) {
  return new SignStream(opts);
};
jws$3.createVerify = function createVerify(opts) {
  return new VerifyStream(opts);
};
var jws$2 = jws$3;
var decode$1 = function(jwt2, options) {
  options = options || {};
  var decoded = jws$2.decode(jwt2, options);
  if (!decoded) {
    return null;
  }
  var payload = decoded.payload;
  if (typeof payload === "string") {
    try {
      var obj = JSON.parse(payload);
      if (obj !== null && typeof obj === "object") {
        payload = obj;
      }
    } catch (e) {
    }
  }
  if (options.complete === true) {
    return {
      header: decoded.header,
      payload,
      signature: decoded.signature
    };
  }
  return payload;
};
var JsonWebTokenError$3 = function(message, error) {
  Error.call(this, message);
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  }
  this.name = "JsonWebTokenError";
  this.message = message;
  if (error) this.inner = error;
};
JsonWebTokenError$3.prototype = Object.create(Error.prototype);
JsonWebTokenError$3.prototype.constructor = JsonWebTokenError$3;
var JsonWebTokenError_1 = JsonWebTokenError$3;
var JsonWebTokenError$2 = JsonWebTokenError_1;
var NotBeforeError$1 = function(message, date) {
  JsonWebTokenError$2.call(this, message);
  this.name = "NotBeforeError";
  this.date = date;
};
NotBeforeError$1.prototype = Object.create(JsonWebTokenError$2.prototype);
NotBeforeError$1.prototype.constructor = NotBeforeError$1;
var NotBeforeError_1 = NotBeforeError$1;
var JsonWebTokenError$1 = JsonWebTokenError_1;
var TokenExpiredError$1 = function(message, expiredAt) {
  JsonWebTokenError$1.call(this, message);
  this.name = "TokenExpiredError";
  this.expiredAt = expiredAt;
};
TokenExpiredError$1.prototype = Object.create(JsonWebTokenError$1.prototype);
TokenExpiredError$1.prototype.constructor = TokenExpiredError$1;
var TokenExpiredError_1 = TokenExpiredError$1;
var s = 1e3;
var m = s * 60;
var h = m * 60;
var d = h * 24;
var w = d * 7;
var y = d * 365.25;
var ms$1 = function(val, options) {
  options = options || {};
  var type = typeof val;
  if (type === "string" && val.length > 0) {
    return parse$8(val);
  } else if (type === "number" && isFinite(val)) {
    return options.long ? fmtLong(val) : fmtShort(val);
  }
  throw new Error(
    "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
  );
};
function parse$8(str) {
  str = String(str);
  if (str.length > 100) {
    return;
  }
  var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
    str
  );
  if (!match) {
    return;
  }
  var n = parseFloat(match[1]);
  var type = (match[2] || "ms").toLowerCase();
  switch (type) {
    case "years":
    case "year":
    case "yrs":
    case "yr":
    case "y":
      return n * y;
    case "weeks":
    case "week":
    case "w":
      return n * w;
    case "days":
    case "day":
    case "d":
      return n * d;
    case "hours":
    case "hour":
    case "hrs":
    case "hr":
    case "h":
      return n * h;
    case "minutes":
    case "minute":
    case "mins":
    case "min":
    case "m":
      return n * m;
    case "seconds":
    case "second":
    case "secs":
    case "sec":
    case "s":
      return n * s;
    case "milliseconds":
    case "millisecond":
    case "msecs":
    case "msec":
    case "ms":
      return n;
    default:
      return void 0;
  }
}
function fmtShort(ms2) {
  var msAbs = Math.abs(ms2);
  if (msAbs >= d) {
    return Math.round(ms2 / d) + "d";
  }
  if (msAbs >= h) {
    return Math.round(ms2 / h) + "h";
  }
  if (msAbs >= m) {
    return Math.round(ms2 / m) + "m";
  }
  if (msAbs >= s) {
    return Math.round(ms2 / s) + "s";
  }
  return ms2 + "ms";
}
function fmtLong(ms2) {
  var msAbs = Math.abs(ms2);
  if (msAbs >= d) {
    return plural(ms2, msAbs, d, "day");
  }
  if (msAbs >= h) {
    return plural(ms2, msAbs, h, "hour");
  }
  if (msAbs >= m) {
    return plural(ms2, msAbs, m, "minute");
  }
  if (msAbs >= s) {
    return plural(ms2, msAbs, s, "second");
  }
  return ms2 + " ms";
}
function plural(ms2, msAbs, n, name) {
  var isPlural = msAbs >= n * 1.5;
  return Math.round(ms2 / n) + " " + name + (isPlural ? "s" : "");
}
var ms = ms$1;
var timespan$2 = function(time, iat) {
  var timestamp = iat || Math.floor(Date.now() / 1e3);
  if (typeof time === "string") {
    var milliseconds = ms(time);
    if (typeof milliseconds === "undefined") {
      return;
    }
    return Math.floor(timestamp + milliseconds / 1e3);
  } else if (typeof time === "number") {
    return timestamp + time;
  } else {
    return;
  }
};
var re$2 = { exports: {} };
const SEMVER_SPEC_VERSION = "2.0.0";
const MAX_LENGTH$1 = 256;
const MAX_SAFE_INTEGER$2 = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
9007199254740991;
const MAX_SAFE_COMPONENT_LENGTH = 16;
const MAX_SAFE_BUILD_LENGTH = MAX_LENGTH$1 - 6;
const RELEASE_TYPES = [
  "major",
  "premajor",
  "minor",
  "preminor",
  "patch",
  "prepatch",
  "prerelease"
];
var constants$2 = {
  MAX_LENGTH: MAX_LENGTH$1,
  MAX_SAFE_COMPONENT_LENGTH,
  MAX_SAFE_BUILD_LENGTH,
  MAX_SAFE_INTEGER: MAX_SAFE_INTEGER$2,
  RELEASE_TYPES,
  SEMVER_SPEC_VERSION,
  FLAG_INCLUDE_PRERELEASE: 1,
  FLAG_LOOSE: 2
};
const debug$1 = typeof process === "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...args) => console.error("SEMVER", ...args) : () => {
};
var debug_1 = debug$1;
(function(module, exports) {
  const {
    MAX_SAFE_COMPONENT_LENGTH: MAX_SAFE_COMPONENT_LENGTH2,
    MAX_SAFE_BUILD_LENGTH: MAX_SAFE_BUILD_LENGTH2,
    MAX_LENGTH: MAX_LENGTH2
  } = constants$2;
  const debug2 = debug_1;
  exports = module.exports = {};
  const re2 = exports.re = [];
  const safeRe = exports.safeRe = [];
  const src = exports.src = [];
  const safeSrc = exports.safeSrc = [];
  const t2 = exports.t = {};
  let R = 0;
  const LETTERDASHNUMBER = "[a-zA-Z0-9-]";
  const safeRegexReplacements = [
    ["\\s", 1],
    ["\\d", MAX_LENGTH2],
    [LETTERDASHNUMBER, MAX_SAFE_BUILD_LENGTH2]
  ];
  const makeSafeRegex = (value) => {
    for (const [token, max] of safeRegexReplacements) {
      value = value.split(`${token}*`).join(`${token}{0,${max}}`).split(`${token}+`).join(`${token}{1,${max}}`);
    }
    return value;
  };
  const createToken = (name, value, isGlobal) => {
    const safe = makeSafeRegex(value);
    const index = R++;
    debug2(name, index, value);
    t2[name] = index;
    src[index] = value;
    safeSrc[index] = safe;
    re2[index] = new RegExp(value, isGlobal ? "g" : void 0);
    safeRe[index] = new RegExp(safe, isGlobal ? "g" : void 0);
  };
  createToken("NUMERICIDENTIFIER", "0|[1-9]\\d*");
  createToken("NUMERICIDENTIFIERLOOSE", "\\d+");
  createToken("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`);
  createToken("MAINVERSION", `(${src[t2.NUMERICIDENTIFIER]})\\.(${src[t2.NUMERICIDENTIFIER]})\\.(${src[t2.NUMERICIDENTIFIER]})`);
  createToken("MAINVERSIONLOOSE", `(${src[t2.NUMERICIDENTIFIERLOOSE]})\\.(${src[t2.NUMERICIDENTIFIERLOOSE]})\\.(${src[t2.NUMERICIDENTIFIERLOOSE]})`);
  createToken("PRERELEASEIDENTIFIER", `(?:${src[t2.NONNUMERICIDENTIFIER]}|${src[t2.NUMERICIDENTIFIER]})`);
  createToken("PRERELEASEIDENTIFIERLOOSE", `(?:${src[t2.NONNUMERICIDENTIFIER]}|${src[t2.NUMERICIDENTIFIERLOOSE]})`);
  createToken("PRERELEASE", `(?:-(${src[t2.PRERELEASEIDENTIFIER]}(?:\\.${src[t2.PRERELEASEIDENTIFIER]})*))`);
  createToken("PRERELEASELOOSE", `(?:-?(${src[t2.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${src[t2.PRERELEASEIDENTIFIERLOOSE]})*))`);
  createToken("BUILDIDENTIFIER", `${LETTERDASHNUMBER}+`);
  createToken("BUILD", `(?:\\+(${src[t2.BUILDIDENTIFIER]}(?:\\.${src[t2.BUILDIDENTIFIER]})*))`);
  createToken("FULLPLAIN", `v?${src[t2.MAINVERSION]}${src[t2.PRERELEASE]}?${src[t2.BUILD]}?`);
  createToken("FULL", `^${src[t2.FULLPLAIN]}$`);
  createToken("LOOSEPLAIN", `[v=\\s]*${src[t2.MAINVERSIONLOOSE]}${src[t2.PRERELEASELOOSE]}?${src[t2.BUILD]}?`);
  createToken("LOOSE", `^${src[t2.LOOSEPLAIN]}$`);
  createToken("GTLT", "((?:<|>)?=?)");
  createToken("XRANGEIDENTIFIERLOOSE", `${src[t2.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`);
  createToken("XRANGEIDENTIFIER", `${src[t2.NUMERICIDENTIFIER]}|x|X|\\*`);
  createToken("XRANGEPLAIN", `[v=\\s]*(${src[t2.XRANGEIDENTIFIER]})(?:\\.(${src[t2.XRANGEIDENTIFIER]})(?:\\.(${src[t2.XRANGEIDENTIFIER]})(?:${src[t2.PRERELEASE]})?${src[t2.BUILD]}?)?)?`);
  createToken("XRANGEPLAINLOOSE", `[v=\\s]*(${src[t2.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t2.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t2.XRANGEIDENTIFIERLOOSE]})(?:${src[t2.PRERELEASELOOSE]})?${src[t2.BUILD]}?)?)?`);
  createToken("XRANGE", `^${src[t2.GTLT]}\\s*${src[t2.XRANGEPLAIN]}$`);
  createToken("XRANGELOOSE", `^${src[t2.GTLT]}\\s*${src[t2.XRANGEPLAINLOOSE]}$`);
  createToken("COERCEPLAIN", `${"(^|[^\\d])(\\d{1,"}${MAX_SAFE_COMPONENT_LENGTH2}})(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH2}}))?(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH2}}))?`);
  createToken("COERCE", `${src[t2.COERCEPLAIN]}(?:$|[^\\d])`);
  createToken("COERCEFULL", src[t2.COERCEPLAIN] + `(?:${src[t2.PRERELEASE]})?(?:${src[t2.BUILD]})?(?:$|[^\\d])`);
  createToken("COERCERTL", src[t2.COERCE], true);
  createToken("COERCERTLFULL", src[t2.COERCEFULL], true);
  createToken("LONETILDE", "(?:~>?)");
  createToken("TILDETRIM", `(\\s*)${src[t2.LONETILDE]}\\s+`, true);
  exports.tildeTrimReplace = "$1~";
  createToken("TILDE", `^${src[t2.LONETILDE]}${src[t2.XRANGEPLAIN]}$`);
  createToken("TILDELOOSE", `^${src[t2.LONETILDE]}${src[t2.XRANGEPLAINLOOSE]}$`);
  createToken("LONECARET", "(?:\\^)");
  createToken("CARETTRIM", `(\\s*)${src[t2.LONECARET]}\\s+`, true);
  exports.caretTrimReplace = "$1^";
  createToken("CARET", `^${src[t2.LONECARET]}${src[t2.XRANGEPLAIN]}$`);
  createToken("CARETLOOSE", `^${src[t2.LONECARET]}${src[t2.XRANGEPLAINLOOSE]}$`);
  createToken("COMPARATORLOOSE", `^${src[t2.GTLT]}\\s*(${src[t2.LOOSEPLAIN]})$|^$`);
  createToken("COMPARATOR", `^${src[t2.GTLT]}\\s*(${src[t2.FULLPLAIN]})$|^$`);
  createToken("COMPARATORTRIM", `(\\s*)${src[t2.GTLT]}\\s*(${src[t2.LOOSEPLAIN]}|${src[t2.XRANGEPLAIN]})`, true);
  exports.comparatorTrimReplace = "$1$2$3";
  createToken("HYPHENRANGE", `^\\s*(${src[t2.XRANGEPLAIN]})\\s+-\\s+(${src[t2.XRANGEPLAIN]})\\s*$`);
  createToken("HYPHENRANGELOOSE", `^\\s*(${src[t2.XRANGEPLAINLOOSE]})\\s+-\\s+(${src[t2.XRANGEPLAINLOOSE]})\\s*$`);
  createToken("STAR", "(<|>)?=?\\s*\\*");
  createToken("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$");
  createToken("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
})(re$2, re$2.exports);
var reExports = re$2.exports;
const looseOption = Object.freeze({ loose: true });
const emptyOpts = Object.freeze({});
const parseOptions$1 = (options) => {
  if (!options) {
    return emptyOpts;
  }
  if (typeof options !== "object") {
    return looseOption;
  }
  return options;
};
var parseOptions_1 = parseOptions$1;
const numeric = /^[0-9]+$/;
const compareIdentifiers$1 = (a, b) => {
  if (typeof a === "number" && typeof b === "number") {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  const anum = numeric.test(a);
  const bnum = numeric.test(b);
  if (anum && bnum) {
    a = +a;
    b = +b;
  }
  return a === b ? 0 : anum && !bnum ? -1 : bnum && !anum ? 1 : a < b ? -1 : 1;
};
const rcompareIdentifiers = (a, b) => compareIdentifiers$1(b, a);
var identifiers$1 = {
  compareIdentifiers: compareIdentifiers$1,
  rcompareIdentifiers
};
const debug = debug_1;
const { MAX_LENGTH, MAX_SAFE_INTEGER: MAX_SAFE_INTEGER$1 } = constants$2;
const { safeRe: re$1, t: t$1 } = reExports;
const parseOptions = parseOptions_1;
const { compareIdentifiers } = identifiers$1;
const isPrereleaseIdentifier = (prerelease2, identifier) => {
  const identifiers2 = identifier.split(".");
  if (identifiers2.length > prerelease2.length) {
    return false;
  }
  for (let i = 0; i < identifiers2.length; i++) {
    if (compareIdentifiers(prerelease2[i], identifiers2[i]) !== 0) {
      return false;
    }
  }
  return true;
};
let SemVer$e = class SemVer {
  constructor(version, options) {
    options = parseOptions(options);
    if (version instanceof SemVer) {
      if (version.loose === !!options.loose && version.includePrerelease === !!options.includePrerelease) {
        return version;
      } else {
        version = version.version;
      }
    } else if (typeof version !== "string") {
      throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version}".`);
    }
    if (version.length > MAX_LENGTH) {
      throw new TypeError(
        `version is longer than ${MAX_LENGTH} characters`
      );
    }
    debug("SemVer", version, options);
    this.options = options;
    this.loose = !!options.loose;
    this.includePrerelease = !!options.includePrerelease;
    const m2 = version.trim().match(options.loose ? re$1[t$1.LOOSE] : re$1[t$1.FULL]);
    if (!m2) {
      throw new TypeError(`Invalid Version: ${version}`);
    }
    this.raw = version;
    this.major = +m2[1];
    this.minor = +m2[2];
    this.patch = +m2[3];
    if (this.major > MAX_SAFE_INTEGER$1 || this.major < 0) {
      throw new TypeError("Invalid major version");
    }
    if (this.minor > MAX_SAFE_INTEGER$1 || this.minor < 0) {
      throw new TypeError("Invalid minor version");
    }
    if (this.patch > MAX_SAFE_INTEGER$1 || this.patch < 0) {
      throw new TypeError("Invalid patch version");
    }
    if (!m2[4]) {
      this.prerelease = [];
    } else {
      this.prerelease = m2[4].split(".").map((id) => {
        if (/^[0-9]+$/.test(id)) {
          const num = +id;
          if (num >= 0 && num < MAX_SAFE_INTEGER$1) {
            return num;
          }
        }
        return id;
      });
    }
    this.build = m2[5] ? m2[5].split(".") : [];
    this.format();
  }
  format() {
    this.version = `${this.major}.${this.minor}.${this.patch}`;
    if (this.prerelease.length) {
      this.version += `-${this.prerelease.join(".")}`;
    }
    return this.version;
  }
  toString() {
    return this.version;
  }
  compare(other) {
    debug("SemVer.compare", this.version, this.options, other);
    if (!(other instanceof SemVer)) {
      if (typeof other === "string" && other === this.version) {
        return 0;
      }
      other = new SemVer(other, this.options);
    }
    if (other.version === this.version) {
      return 0;
    }
    return this.compareMain(other) || this.comparePre(other);
  }
  compareMain(other) {
    if (!(other instanceof SemVer)) {
      other = new SemVer(other, this.options);
    }
    if (this.major < other.major) {
      return -1;
    }
    if (this.major > other.major) {
      return 1;
    }
    if (this.minor < other.minor) {
      return -1;
    }
    if (this.minor > other.minor) {
      return 1;
    }
    if (this.patch < other.patch) {
      return -1;
    }
    if (this.patch > other.patch) {
      return 1;
    }
    return 0;
  }
  comparePre(other) {
    if (!(other instanceof SemVer)) {
      other = new SemVer(other, this.options);
    }
    if (this.prerelease.length && !other.prerelease.length) {
      return -1;
    } else if (!this.prerelease.length && other.prerelease.length) {
      return 1;
    } else if (!this.prerelease.length && !other.prerelease.length) {
      return 0;
    }
    let i = 0;
    do {
      const a = this.prerelease[i];
      const b = other.prerelease[i];
      debug("prerelease compare", i, a, b);
      if (a === void 0 && b === void 0) {
        return 0;
      } else if (b === void 0) {
        return 1;
      } else if (a === void 0) {
        return -1;
      } else if (a === b) {
        continue;
      } else {
        return compareIdentifiers(a, b);
      }
    } while (++i);
  }
  compareBuild(other) {
    if (!(other instanceof SemVer)) {
      other = new SemVer(other, this.options);
    }
    let i = 0;
    do {
      const a = this.build[i];
      const b = other.build[i];
      debug("build compare", i, a, b);
      if (a === void 0 && b === void 0) {
        return 0;
      } else if (b === void 0) {
        return 1;
      } else if (a === void 0) {
        return -1;
      } else if (a === b) {
        continue;
      } else {
        return compareIdentifiers(a, b);
      }
    } while (++i);
  }
  // preminor will bump the version up to the next minor release, and immediately
  // down to pre-release. premajor and prepatch work the same way.
  inc(release, identifier, identifierBase) {
    if (release.startsWith("pre")) {
      if (!identifier && identifierBase === false) {
        throw new Error("invalid increment argument: identifier is empty");
      }
      if (identifier) {
        const match = `-${identifier}`.match(this.options.loose ? re$1[t$1.PRERELEASELOOSE] : re$1[t$1.PRERELEASE]);
        if (!match || match[1] !== identifier) {
          throw new Error(`invalid identifier: ${identifier}`);
        }
      }
    }
    switch (release) {
      case "premajor":
        this.prerelease.length = 0;
        this.patch = 0;
        this.minor = 0;
        this.major++;
        this.inc("pre", identifier, identifierBase);
        break;
      case "preminor":
        this.prerelease.length = 0;
        this.patch = 0;
        this.minor++;
        this.inc("pre", identifier, identifierBase);
        break;
      case "prepatch":
        this.prerelease.length = 0;
        this.inc("patch", identifier, identifierBase);
        this.inc("pre", identifier, identifierBase);
        break;
      case "prerelease":
        if (this.prerelease.length === 0) {
          this.inc("patch", identifier, identifierBase);
        }
        this.inc("pre", identifier, identifierBase);
        break;
      case "release":
        if (this.prerelease.length === 0) {
          throw new Error(`version ${this.raw} is not a prerelease`);
        }
        this.prerelease.length = 0;
        break;
      case "major":
        if (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) {
          this.major++;
        }
        this.minor = 0;
        this.patch = 0;
        this.prerelease = [];
        break;
      case "minor":
        if (this.patch !== 0 || this.prerelease.length === 0) {
          this.minor++;
        }
        this.patch = 0;
        this.prerelease = [];
        break;
      case "patch":
        if (this.prerelease.length === 0) {
          this.patch++;
        }
        this.prerelease = [];
        break;
      case "pre": {
        const base = Number(identifierBase) ? 1 : 0;
        if (this.prerelease.length === 0) {
          this.prerelease = [base];
        } else {
          let i = this.prerelease.length;
          while (--i >= 0) {
            if (typeof this.prerelease[i] === "number") {
              this.prerelease[i]++;
              i = -2;
            }
          }
          if (i === -1) {
            if (identifier === this.prerelease.join(".") && identifierBase === false) {
              throw new Error("invalid increment argument: identifier already exists");
            }
            this.prerelease.push(base);
          }
        }
        if (identifier) {
          let prerelease2 = [identifier, base];
          if (identifierBase === false) {
            prerelease2 = [identifier];
          }
          if (isPrereleaseIdentifier(this.prerelease, identifier)) {
            const prereleaseBase = this.prerelease[identifier.split(".").length];
            if (isNaN(prereleaseBase)) {
              this.prerelease = prerelease2;
            }
          } else {
            this.prerelease = prerelease2;
          }
        }
        break;
      }
      default:
        throw new Error(`invalid increment argument: ${release}`);
    }
    this.raw = this.format();
    if (this.build.length) {
      this.raw += `+${this.build.join(".")}`;
    }
    return this;
  }
};
var semver$4 = SemVer$e;
const SemVer$d = semver$4;
const parse$7 = (version, options, throwErrors = false) => {
  if (version instanceof SemVer$d) {
    return version;
  }
  try {
    return new SemVer$d(version, options);
  } catch (er) {
    if (!throwErrors) {
      return null;
    }
    throw er;
  }
};
var parse_1 = parse$7;
const parse$6 = parse_1;
const valid$2 = (version, options) => {
  const v = parse$6(version, options);
  return v ? v.version : null;
};
var valid_1 = valid$2;
const parse$5 = parse_1;
const clean$1 = (version, options) => {
  const s2 = parse$5(version.trim().replace(/^[=v]+/, ""), options);
  return s2 ? s2.version : null;
};
var clean_1 = clean$1;
const SemVer$c = semver$4;
const inc$1 = (version, release, options, identifier, identifierBase) => {
  if (typeof options === "string") {
    identifierBase = identifier;
    identifier = options;
    options = void 0;
  }
  try {
    return new SemVer$c(
      version instanceof SemVer$c ? version.version : version,
      options
    ).inc(release, identifier, identifierBase).version;
  } catch (er) {
    return null;
  }
};
var inc_1 = inc$1;
const parse$4 = parse_1;
const diff$1 = (version1, version2) => {
  const v1 = parse$4(version1, null, true);
  const v2 = parse$4(version2, null, true);
  const comparison = v1.compare(v2);
  if (comparison === 0) {
    return null;
  }
  const v1Higher = comparison > 0;
  const highVersion = v1Higher ? v1 : v2;
  const lowVersion = v1Higher ? v2 : v1;
  const highHasPre = !!highVersion.prerelease.length;
  const lowHasPre = !!lowVersion.prerelease.length;
  if (lowHasPre && !highHasPre) {
    if (!lowVersion.patch && !lowVersion.minor) {
      return "major";
    }
    if (lowVersion.compareMain(highVersion) === 0) {
      if (lowVersion.minor && !lowVersion.patch) {
        return "minor";
      }
      return "patch";
    }
  }
  const prefix = highHasPre ? "pre" : "";
  if (v1.major !== v2.major) {
    return prefix + "major";
  }
  if (v1.minor !== v2.minor) {
    return prefix + "minor";
  }
  if (v1.patch !== v2.patch) {
    return prefix + "patch";
  }
  return "prerelease";
};
var diff_1 = diff$1;
const SemVer$b = semver$4;
const major$1 = (a, loose) => new SemVer$b(a, loose).major;
var major_1 = major$1;
const SemVer$a = semver$4;
const minor$1 = (a, loose) => new SemVer$a(a, loose).minor;
var minor_1 = minor$1;
const SemVer$9 = semver$4;
const patch$1 = (a, loose) => new SemVer$9(a, loose).patch;
var patch_1 = patch$1;
const parse$3 = parse_1;
const prerelease$1 = (version, options) => {
  const parsed = parse$3(version, options);
  return parsed && parsed.prerelease.length ? parsed.prerelease : null;
};
var prerelease_1 = prerelease$1;
const SemVer$8 = semver$4;
const compare$b = (a, b, loose) => new SemVer$8(a, loose).compare(new SemVer$8(b, loose));
var compare_1 = compare$b;
const compare$a = compare_1;
const rcompare$1 = (a, b, loose) => compare$a(b, a, loose);
var rcompare_1 = rcompare$1;
const compare$9 = compare_1;
const compareLoose$1 = (a, b) => compare$9(a, b, true);
var compareLoose_1 = compareLoose$1;
const SemVer$7 = semver$4;
const compareBuild$3 = (a, b, loose) => {
  const versionA = new SemVer$7(a, loose);
  const versionB = new SemVer$7(b, loose);
  return versionA.compare(versionB) || versionA.compareBuild(versionB);
};
var compareBuild_1 = compareBuild$3;
const compareBuild$2 = compareBuild_1;
const sort$1 = (list, loose) => list.sort((a, b) => compareBuild$2(a, b, loose));
var sort_1 = sort$1;
const compareBuild$1 = compareBuild_1;
const rsort$1 = (list, loose) => list.sort((a, b) => compareBuild$1(b, a, loose));
var rsort_1 = rsort$1;
const compare$8 = compare_1;
const gt$4 = (a, b, loose) => compare$8(a, b, loose) > 0;
var gt_1 = gt$4;
const compare$7 = compare_1;
const lt$3 = (a, b, loose) => compare$7(a, b, loose) < 0;
var lt_1 = lt$3;
const compare$6 = compare_1;
const eq$2 = (a, b, loose) => compare$6(a, b, loose) === 0;
var eq_1 = eq$2;
const compare$5 = compare_1;
const neq$2 = (a, b, loose) => compare$5(a, b, loose) !== 0;
var neq_1 = neq$2;
const compare$4 = compare_1;
const gte$3 = (a, b, loose) => compare$4(a, b, loose) >= 0;
var gte_1 = gte$3;
const compare$3 = compare_1;
const lte$3 = (a, b, loose) => compare$3(a, b, loose) <= 0;
var lte_1 = lte$3;
const eq$1 = eq_1;
const neq$1 = neq_1;
const gt$3 = gt_1;
const gte$2 = gte_1;
const lt$2 = lt_1;
const lte$2 = lte_1;
const cmp$1 = (a, op, b, loose) => {
  switch (op) {
    case "===":
      if (typeof a === "object") {
        a = a.version;
      }
      if (typeof b === "object") {
        b = b.version;
      }
      return a === b;
    case "!==":
      if (typeof a === "object") {
        a = a.version;
      }
      if (typeof b === "object") {
        b = b.version;
      }
      return a !== b;
    case "":
    case "=":
    case "==":
      return eq$1(a, b, loose);
    case "!=":
      return neq$1(a, b, loose);
    case ">":
      return gt$3(a, b, loose);
    case ">=":
      return gte$2(a, b, loose);
    case "<":
      return lt$2(a, b, loose);
    case "<=":
      return lte$2(a, b, loose);
    default:
      throw new TypeError(`Invalid operator: ${op}`);
  }
};
var cmp_1 = cmp$1;
const SemVer$6 = semver$4;
const parse$2 = parse_1;
const { safeRe: re, t } = reExports;
const coerce$1 = (version, options) => {
  if (version instanceof SemVer$6) {
    return version;
  }
  if (typeof version === "number") {
    version = String(version);
  }
  if (typeof version !== "string") {
    return null;
  }
  options = options || {};
  let match = null;
  if (!options.rtl) {
    match = version.match(options.includePrerelease ? re[t.COERCEFULL] : re[t.COERCE]);
  } else {
    const coerceRtlRegex = options.includePrerelease ? re[t.COERCERTLFULL] : re[t.COERCERTL];
    let next;
    while ((next = coerceRtlRegex.exec(version)) && (!match || match.index + match[0].length !== version.length)) {
      if (!match || next.index + next[0].length !== match.index + match[0].length) {
        match = next;
      }
      coerceRtlRegex.lastIndex = next.index + next[1].length + next[2].length;
    }
    coerceRtlRegex.lastIndex = -1;
  }
  if (match === null) {
    return null;
  }
  const major2 = match[2];
  const minor2 = match[3] || "0";
  const patch2 = match[4] || "0";
  const prerelease2 = options.includePrerelease && match[5] ? `-${match[5]}` : "";
  const build = options.includePrerelease && match[6] ? `+${match[6]}` : "";
  return parse$2(`${major2}.${minor2}.${patch2}${prerelease2}${build}`, options);
};
var coerce_1 = coerce$1;
const parse$1 = parse_1;
const constants$1 = constants$2;
const SemVer$5 = semver$4;
const truncate$1 = (version, truncation, options) => {
  if (!constants$1.RELEASE_TYPES.includes(truncation)) {
    return null;
  }
  const clonedVersion = cloneInputVersion(version, options);
  return clonedVersion && doTruncation(clonedVersion, truncation);
};
const cloneInputVersion = (version, options) => {
  const versionStringToParse = version instanceof SemVer$5 ? version.version : version;
  return parse$1(versionStringToParse, options);
};
const doTruncation = (version, truncation) => {
  if (isPrerelease(truncation)) {
    return version.version;
  }
  version.prerelease = [];
  switch (truncation) {
    case "major":
      version.minor = 0;
      version.patch = 0;
      break;
    case "minor":
      version.patch = 0;
      break;
  }
  return version.format();
};
const isPrerelease = (type) => {
  return type.startsWith("pre");
};
var truncate_1 = truncate$1;
class LRUCache {
  constructor() {
    this.max = 1e3;
    this.map = /* @__PURE__ */ new Map();
  }
  get(key) {
    const value = this.map.get(key);
    if (value === void 0) {
      return void 0;
    } else {
      this.map.delete(key);
      this.map.set(key, value);
      return value;
    }
  }
  delete(key) {
    return this.map.delete(key);
  }
  set(key, value) {
    const deleted = this.delete(key);
    if (!deleted && value !== void 0) {
      if (this.map.size >= this.max) {
        const firstKey = this.map.keys().next().value;
        this.delete(firstKey);
      }
      this.map.set(key, value);
    }
    return this;
  }
}
var lrucache = LRUCache;
var range;
var hasRequiredRange;
function requireRange() {
  if (hasRequiredRange) return range;
  hasRequiredRange = 1;
  const SPACE_CHARACTERS = /\s+/g;
  class Range2 {
    constructor(range2, options) {
      options = parseOptions2(options);
      if (range2 instanceof Range2) {
        if (range2.loose === !!options.loose && range2.includePrerelease === !!options.includePrerelease) {
          return range2;
        } else {
          return new Range2(range2.raw, options);
        }
      }
      if (range2 instanceof Comparator2) {
        this.raw = range2.value;
        this.set = [[range2]];
        this.formatted = void 0;
        return this;
      }
      this.options = options;
      this.loose = !!options.loose;
      this.includePrerelease = !!options.includePrerelease;
      this.raw = range2.trim().replace(SPACE_CHARACTERS, " ");
      this.set = this.raw.split("||").map((r) => this.parseRange(r.trim())).filter((c) => c.length);
      if (!this.set.length) {
        throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
      }
      if (this.set.length > 1) {
        const first = this.set[0];
        this.set = this.set.filter((c) => !isNullSet(c[0]));
        if (this.set.length === 0) {
          this.set = [first];
        } else if (this.set.length > 1) {
          for (const c of this.set) {
            if (c.length === 1 && isAny(c[0])) {
              this.set = [c];
              break;
            }
          }
        }
      }
      this.formatted = void 0;
    }
    get range() {
      if (this.formatted === void 0) {
        this.formatted = "";
        for (let i = 0; i < this.set.length; i++) {
          if (i > 0) {
            this.formatted += "||";
          }
          const comps = this.set[i];
          for (let k = 0; k < comps.length; k++) {
            if (k > 0) {
              this.formatted += " ";
            }
            this.formatted += comps[k].toString().trim();
          }
        }
      }
      return this.formatted;
    }
    format() {
      return this.range;
    }
    toString() {
      return this.range;
    }
    parseRange(range2) {
      range2 = range2.replace(BUILDSTRIPRE, "");
      const memoOpts = (this.options.includePrerelease && FLAG_INCLUDE_PRERELEASE) | (this.options.loose && FLAG_LOOSE);
      const memoKey = memoOpts + ":" + range2;
      const cached = cache.get(memoKey);
      if (cached) {
        return cached;
      }
      const loose = this.options.loose;
      const hr = loose ? re2[t2.HYPHENRANGELOOSE] : re2[t2.HYPHENRANGE];
      range2 = range2.replace(hr, hyphenReplace(this.options.includePrerelease));
      debug2("hyphen replace", range2);
      range2 = range2.replace(re2[t2.COMPARATORTRIM], comparatorTrimReplace);
      debug2("comparator trim", range2);
      range2 = range2.replace(re2[t2.TILDETRIM], tildeTrimReplace);
      debug2("tilde trim", range2);
      range2 = range2.replace(re2[t2.CARETTRIM], caretTrimReplace);
      debug2("caret trim", range2);
      let rangeList = range2.split(" ").map((comp) => parseComparator(comp, this.options)).join(" ").split(/\s+/).map((comp) => replaceGTE0(comp, this.options));
      if (loose) {
        rangeList = rangeList.filter((comp) => {
          debug2("loose invalid filter", comp, this.options);
          return !!comp.match(re2[t2.COMPARATORLOOSE]);
        });
      }
      debug2("range list", rangeList);
      const rangeMap = /* @__PURE__ */ new Map();
      const comparators = rangeList.map((comp) => new Comparator2(comp, this.options));
      for (const comp of comparators) {
        if (isNullSet(comp)) {
          return [comp];
        }
        rangeMap.set(comp.value, comp);
      }
      if (rangeMap.size > 1 && rangeMap.has("")) {
        rangeMap.delete("");
      }
      const result = [...rangeMap.values()];
      cache.set(memoKey, result);
      return result;
    }
    intersects(range2, options) {
      if (!(range2 instanceof Range2)) {
        throw new TypeError("a Range is required");
      }
      return this.set.some((thisComparators) => {
        return isSatisfiable(thisComparators, options) && range2.set.some((rangeComparators) => {
          return isSatisfiable(rangeComparators, options) && thisComparators.every((thisComparator) => {
            return rangeComparators.every((rangeComparator) => {
              return thisComparator.intersects(rangeComparator, options);
            });
          });
        });
      });
    }
    // if ANY of the sets match ALL of its comparators, then pass
    test(version) {
      if (!version) {
        return false;
      }
      if (typeof version === "string") {
        try {
          version = new SemVer3(version, this.options);
        } catch (er) {
          return false;
        }
      }
      for (let i = 0; i < this.set.length; i++) {
        if (testSet(this.set[i], version, this.options)) {
          return true;
        }
      }
      return false;
    }
  }
  range = Range2;
  const LRU = lrucache;
  const cache = new LRU();
  const parseOptions2 = parseOptions_1;
  const Comparator2 = requireComparator();
  const debug2 = debug_1;
  const SemVer3 = semver$4;
  const {
    safeRe: re2,
    src,
    t: t2,
    comparatorTrimReplace,
    tildeTrimReplace,
    caretTrimReplace
  } = reExports;
  const { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } = constants$2;
  const BUILDSTRIPRE = new RegExp(src[t2.BUILD], "g");
  const isNullSet = (c) => c.value === "<0.0.0-0";
  const isAny = (c) => c.value === "";
  const isSatisfiable = (comparators, options) => {
    let result = true;
    const remainingComparators = comparators.slice();
    let testComparator = remainingComparators.pop();
    while (result && remainingComparators.length) {
      result = remainingComparators.every((otherComparator) => {
        return testComparator.intersects(otherComparator, options);
      });
      testComparator = remainingComparators.pop();
    }
    return result;
  };
  const parseComparator = (comp, options) => {
    comp = comp.replace(re2[t2.BUILD], "");
    debug2("comp", comp, options);
    comp = replaceCarets(comp, options);
    debug2("caret", comp);
    comp = replaceTildes(comp, options);
    debug2("tildes", comp);
    comp = replaceXRanges(comp, options);
    debug2("xrange", comp);
    comp = replaceStars(comp, options);
    debug2("stars", comp);
    return comp;
  };
  const isX = (id) => !id || id.toLowerCase() === "x" || id === "*";
  const invalidXRangeOrder = (M, m2, p) => isX(M) && !isX(m2) || isX(m2) && p && !isX(p);
  const replaceTildes = (comp, options) => {
    return comp.trim().split(/\s+/).map((c) => replaceTilde(c, options)).join(" ");
  };
  const replaceTilde = (comp, options) => {
    const r = options.loose ? re2[t2.TILDELOOSE] : re2[t2.TILDE];
    const z = options.includePrerelease ? "-0" : "";
    return comp.replace(r, (_, M, m2, p, pr) => {
      debug2("tilde", comp, _, M, m2, p, pr);
      let ret;
      if (isX(M)) {
        ret = "";
      } else if (isX(m2)) {
        ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
      } else if (isX(p)) {
        ret = `>=${M}.${m2}.0${z} <${M}.${+m2 + 1}.0-0`;
      } else if (pr) {
        debug2("replaceTilde pr", pr);
        ret = `>=${M}.${m2}.${p}-${pr} <${M}.${+m2 + 1}.0-0`;
      } else {
        ret = `>=${M}.${m2}.${p} <${M}.${+m2 + 1}.0-0`;
      }
      debug2("tilde return", ret);
      return ret;
    });
  };
  const replaceCarets = (comp, options) => {
    return comp.trim().split(/\s+/).map((c) => replaceCaret(c, options)).join(" ");
  };
  const replaceCaret = (comp, options) => {
    debug2("caret", comp, options);
    const r = options.loose ? re2[t2.CARETLOOSE] : re2[t2.CARET];
    const z = options.includePrerelease ? "-0" : "";
    return comp.replace(r, (_, M, m2, p, pr) => {
      debug2("caret", comp, _, M, m2, p, pr);
      let ret;
      if (isX(M)) {
        ret = "";
      } else if (isX(m2)) {
        ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
      } else if (isX(p)) {
        if (M === "0") {
          ret = `>=${M}.${m2}.0${z} <${M}.${+m2 + 1}.0-0`;
        } else {
          ret = `>=${M}.${m2}.0${z} <${+M + 1}.0.0-0`;
        }
      } else if (pr) {
        debug2("replaceCaret pr", pr);
        if (M === "0") {
          if (m2 === "0") {
            ret = `>=${M}.${m2}.${p}-${pr} <${M}.${m2}.${+p + 1}-0`;
          } else {
            ret = `>=${M}.${m2}.${p}-${pr} <${M}.${+m2 + 1}.0-0`;
          }
        } else {
          ret = `>=${M}.${m2}.${p}-${pr} <${+M + 1}.0.0-0`;
        }
      } else {
        debug2("no pr");
        if (M === "0") {
          if (m2 === "0") {
            ret = `>=${M}.${m2}.${p} <${M}.${m2}.${+p + 1}-0`;
          } else {
            ret = `>=${M}.${m2}.${p} <${M}.${+m2 + 1}.0-0`;
          }
        } else {
          ret = `>=${M}.${m2}.${p} <${+M + 1}.0.0-0`;
        }
      }
      debug2("caret return", ret);
      return ret;
    });
  };
  const replaceXRanges = (comp, options) => {
    debug2("replaceXRanges", comp, options);
    return comp.split(/\s+/).map((c) => replaceXRange(c, options)).join(" ");
  };
  const replaceXRange = (comp, options) => {
    comp = comp.trim();
    const r = options.loose ? re2[t2.XRANGELOOSE] : re2[t2.XRANGE];
    return comp.replace(r, (ret, gtlt, M, m2, p, pr) => {
      debug2("xRange", comp, ret, gtlt, M, m2, p, pr);
      if (invalidXRangeOrder(M, m2, p)) {
        return comp;
      }
      const xM = isX(M);
      const xm = xM || isX(m2);
      const xp = xm || isX(p);
      const anyX = xp;
      if (gtlt === "=" && anyX) {
        gtlt = "";
      }
      pr = options.includePrerelease ? "-0" : "";
      if (xM) {
        if (gtlt === ">" || gtlt === "<") {
          ret = "<0.0.0-0";
        } else {
          ret = "*";
        }
      } else if (gtlt && anyX) {
        if (xm) {
          m2 = 0;
        }
        p = 0;
        if (gtlt === ">") {
          gtlt = ">=";
          if (xm) {
            M = +M + 1;
            m2 = 0;
            p = 0;
          } else {
            m2 = +m2 + 1;
            p = 0;
          }
        } else if (gtlt === "<=") {
          gtlt = "<";
          if (xm) {
            M = +M + 1;
          } else {
            m2 = +m2 + 1;
          }
        }
        if (gtlt === "<") {
          pr = "-0";
        }
        ret = `${gtlt + M}.${m2}.${p}${pr}`;
      } else if (xm) {
        ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
      } else if (xp) {
        ret = `>=${M}.${m2}.0${pr} <${M}.${+m2 + 1}.0-0`;
      }
      debug2("xRange return", ret);
      return ret;
    });
  };
  const replaceStars = (comp, options) => {
    debug2("replaceStars", comp, options);
    return comp.trim().replace(re2[t2.STAR], "");
  };
  const replaceGTE0 = (comp, options) => {
    debug2("replaceGTE0", comp, options);
    return comp.trim().replace(re2[options.includePrerelease ? t2.GTE0PRE : t2.GTE0], "");
  };
  const hyphenReplace = (incPr) => ($0, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr) => {
    if (isX(fM)) {
      from = "";
    } else if (isX(fm)) {
      from = `>=${fM}.0.0${incPr ? "-0" : ""}`;
    } else if (isX(fp)) {
      from = `>=${fM}.${fm}.0${incPr ? "-0" : ""}`;
    } else if (fpr) {
      from = `>=${from}`;
    } else {
      from = `>=${from}${incPr ? "-0" : ""}`;
    }
    if (isX(tM)) {
      to = "";
    } else if (isX(tm)) {
      to = `<${+tM + 1}.0.0-0`;
    } else if (isX(tp)) {
      to = `<${tM}.${+tm + 1}.0-0`;
    } else if (tpr) {
      to = `<=${tM}.${tm}.${tp}-${tpr}`;
    } else if (incPr) {
      to = `<${tM}.${tm}.${+tp + 1}-0`;
    } else {
      to = `<=${to}`;
    }
    return `${from} ${to}`.trim();
  };
  const testSet = (set, version, options) => {
    for (let i = 0; i < set.length; i++) {
      if (!set[i].test(version)) {
        return false;
      }
    }
    if (version.prerelease.length && !options.includePrerelease) {
      for (let i = 0; i < set.length; i++) {
        debug2(set[i].semver);
        if (set[i].semver === Comparator2.ANY) {
          continue;
        }
        if (set[i].semver.prerelease.length > 0) {
          const allowed = set[i].semver;
          if (allowed.major === version.major && allowed.minor === version.minor && allowed.patch === version.patch) {
            return true;
          }
        }
      }
      return false;
    }
    return true;
  };
  return range;
}
var comparator;
var hasRequiredComparator;
function requireComparator() {
  if (hasRequiredComparator) return comparator;
  hasRequiredComparator = 1;
  const ANY2 = Symbol("SemVer ANY");
  class Comparator2 {
    static get ANY() {
      return ANY2;
    }
    constructor(comp, options) {
      options = parseOptions2(options);
      if (comp instanceof Comparator2) {
        if (comp.loose === !!options.loose) {
          return comp;
        } else {
          comp = comp.value;
        }
      }
      comp = comp.trim().split(/\s+/).join(" ");
      debug2("comparator", comp, options);
      this.options = options;
      this.loose = !!options.loose;
      this.parse(comp);
      if (this.semver === ANY2) {
        this.value = "";
      } else {
        this.value = this.operator + this.semver.version;
      }
      debug2("comp", this);
    }
    parse(comp) {
      const r = this.options.loose ? re2[t2.COMPARATORLOOSE] : re2[t2.COMPARATOR];
      const m2 = comp.match(r);
      if (!m2) {
        throw new TypeError(`Invalid comparator: ${comp}`);
      }
      this.operator = m2[1] !== void 0 ? m2[1] : "";
      if (this.operator === "=") {
        this.operator = "";
      }
      if (!m2[2]) {
        this.semver = ANY2;
      } else {
        this.semver = new SemVer3(m2[2], this.options.loose);
      }
    }
    toString() {
      return this.value;
    }
    test(version) {
      debug2("Comparator.test", version, this.options.loose);
      if (this.semver === ANY2 || version === ANY2) {
        return true;
      }
      if (typeof version === "string") {
        try {
          version = new SemVer3(version, this.options);
        } catch (er) {
          return false;
        }
      }
      return cmp2(version, this.operator, this.semver, this.options);
    }
    intersects(comp, options) {
      if (!(comp instanceof Comparator2)) {
        throw new TypeError("a Comparator is required");
      }
      if (this.operator === "") {
        if (this.value === "") {
          return true;
        }
        return new Range2(comp.value, options).test(this.value);
      } else if (comp.operator === "") {
        if (comp.value === "") {
          return true;
        }
        return new Range2(this.value, options).test(comp.semver);
      }
      options = parseOptions2(options);
      if (options.includePrerelease && (this.value === "<0.0.0-0" || comp.value === "<0.0.0-0")) {
        return false;
      }
      if (!options.includePrerelease && (this.value.startsWith("<0.0.0") || comp.value.startsWith("<0.0.0"))) {
        return false;
      }
      if (this.operator.startsWith(">") && comp.operator.startsWith(">")) {
        return true;
      }
      if (this.operator.startsWith("<") && comp.operator.startsWith("<")) {
        return true;
      }
      if (this.semver.version === comp.semver.version && this.operator.includes("=") && comp.operator.includes("=")) {
        return true;
      }
      if (cmp2(this.semver, "<", comp.semver, options) && this.operator.startsWith(">") && comp.operator.startsWith("<")) {
        return true;
      }
      if (cmp2(this.semver, ">", comp.semver, options) && this.operator.startsWith("<") && comp.operator.startsWith(">")) {
        return true;
      }
      return false;
    }
  }
  comparator = Comparator2;
  const parseOptions2 = parseOptions_1;
  const { safeRe: re2, t: t2 } = reExports;
  const cmp2 = cmp_1;
  const debug2 = debug_1;
  const SemVer3 = semver$4;
  const Range2 = requireRange();
  return comparator;
}
const Range$9 = requireRange();
const satisfies$4 = (version, range2, options) => {
  try {
    range2 = new Range$9(range2, options);
  } catch (er) {
    return false;
  }
  return range2.test(version);
};
var satisfies_1 = satisfies$4;
const Range$8 = requireRange();
const toComparators$1 = (range2, options) => new Range$8(range2, options).set.map((comp) => comp.map((c) => c.value).join(" ").trim().split(" "));
var toComparators_1 = toComparators$1;
const SemVer$4 = semver$4;
const Range$7 = requireRange();
const maxSatisfying$1 = (versions, range2, options) => {
  let max = null;
  let maxSV = null;
  let rangeObj = null;
  try {
    rangeObj = new Range$7(range2, options);
  } catch (er) {
    return null;
  }
  versions.forEach((v) => {
    if (rangeObj.test(v)) {
      if (!max || maxSV.compare(v) === -1) {
        max = v;
        maxSV = new SemVer$4(max, options);
      }
    }
  });
  return max;
};
var maxSatisfying_1 = maxSatisfying$1;
const SemVer$3 = semver$4;
const Range$6 = requireRange();
const minSatisfying$1 = (versions, range2, options) => {
  let min = null;
  let minSV = null;
  let rangeObj = null;
  try {
    rangeObj = new Range$6(range2, options);
  } catch (er) {
    return null;
  }
  versions.forEach((v) => {
    if (rangeObj.test(v)) {
      if (!min || minSV.compare(v) === 1) {
        min = v;
        minSV = new SemVer$3(min, options);
      }
    }
  });
  return min;
};
var minSatisfying_1 = minSatisfying$1;
const SemVer$2 = semver$4;
const Range$5 = requireRange();
const gt$2 = gt_1;
const minVersion$1 = (range2, loose) => {
  range2 = new Range$5(range2, loose);
  let minver = new SemVer$2("0.0.0");
  if (range2.test(minver)) {
    return minver;
  }
  minver = new SemVer$2("0.0.0-0");
  if (range2.test(minver)) {
    return minver;
  }
  minver = null;
  for (let i = 0; i < range2.set.length; ++i) {
    const comparators = range2.set[i];
    let setMin = null;
    comparators.forEach((comparator2) => {
      const compver = new SemVer$2(comparator2.semver.version);
      switch (comparator2.operator) {
        case ">":
          if (compver.prerelease.length === 0) {
            compver.patch++;
          } else {
            compver.prerelease.push(0);
          }
          compver.raw = compver.format();
        case "":
        case ">=":
          if (!setMin || gt$2(compver, setMin)) {
            setMin = compver;
          }
          break;
        case "<":
        case "<=":
          break;
        default:
          throw new Error(`Unexpected operation: ${comparator2.operator}`);
      }
    });
    if (setMin && (!minver || gt$2(minver, setMin))) {
      minver = setMin;
    }
  }
  if (minver && range2.test(minver)) {
    return minver;
  }
  return null;
};
var minVersion_1 = minVersion$1;
const Range$4 = requireRange();
const validRange$1 = (range2, options) => {
  try {
    return new Range$4(range2, options).range || "*";
  } catch (er) {
    return null;
  }
};
var valid$1 = validRange$1;
const SemVer$1 = semver$4;
const Comparator$2 = requireComparator();
const { ANY: ANY$1 } = Comparator$2;
const Range$3 = requireRange();
const satisfies$3 = satisfies_1;
const gt$1 = gt_1;
const lt$1 = lt_1;
const lte$1 = lte_1;
const gte$1 = gte_1;
const outside$3 = (version, range2, hilo, options) => {
  version = new SemVer$1(version, options);
  range2 = new Range$3(range2, options);
  let gtfn, ltefn, ltfn, comp, ecomp;
  switch (hilo) {
    case ">":
      gtfn = gt$1;
      ltefn = lte$1;
      ltfn = lt$1;
      comp = ">";
      ecomp = ">=";
      break;
    case "<":
      gtfn = lt$1;
      ltefn = gte$1;
      ltfn = gt$1;
      comp = "<";
      ecomp = "<=";
      break;
    default:
      throw new TypeError('Must provide a hilo val of "<" or ">"');
  }
  if (satisfies$3(version, range2, options)) {
    return false;
  }
  for (let i = 0; i < range2.set.length; ++i) {
    const comparators = range2.set[i];
    let high = null;
    let low = null;
    comparators.forEach((comparator2) => {
      if (comparator2.semver === ANY$1) {
        comparator2 = new Comparator$2(">=0.0.0");
      }
      high = high || comparator2;
      low = low || comparator2;
      if (gtfn(comparator2.semver, high.semver, options)) {
        high = comparator2;
      } else if (ltfn(comparator2.semver, low.semver, options)) {
        low = comparator2;
      }
    });
    if (high.operator === comp || high.operator === ecomp) {
      return false;
    }
    if ((!low.operator || low.operator === comp) && ltefn(version, low.semver)) {
      return false;
    } else if (low.operator === ecomp && ltfn(version, low.semver)) {
      return false;
    }
  }
  return true;
};
var outside_1 = outside$3;
const outside$2 = outside_1;
const gtr$1 = (version, range2, options) => outside$2(version, range2, ">", options);
var gtr_1 = gtr$1;
const outside$1 = outside_1;
const ltr$1 = (version, range2, options) => outside$1(version, range2, "<", options);
var ltr_1 = ltr$1;
const Range$2 = requireRange();
const intersects$1 = (r1, r2, options) => {
  r1 = new Range$2(r1, options);
  r2 = new Range$2(r2, options);
  return r1.intersects(r2, options);
};
var intersects_1 = intersects$1;
const satisfies$2 = satisfies_1;
const compare$2 = compare_1;
var simplify = (versions, range2, options) => {
  const set = [];
  let first = null;
  let prev = null;
  const v = versions.sort((a, b) => compare$2(a, b, options));
  for (const version of v) {
    const included = satisfies$2(version, range2, options);
    if (included) {
      prev = version;
      if (!first) {
        first = version;
      }
    } else {
      if (prev) {
        set.push([first, prev]);
      }
      prev = null;
      first = null;
    }
  }
  if (first) {
    set.push([first, null]);
  }
  const ranges = [];
  for (const [min, max] of set) {
    if (min === max) {
      ranges.push(min);
    } else if (!max && min === v[0]) {
      ranges.push("*");
    } else if (!max) {
      ranges.push(`>=${min}`);
    } else if (min === v[0]) {
      ranges.push(`<=${max}`);
    } else {
      ranges.push(`${min} - ${max}`);
    }
  }
  const simplified = ranges.join(" || ");
  const original = typeof range2.raw === "string" ? range2.raw : String(range2);
  return simplified.length < original.length ? simplified : range2;
};
const Range$1 = requireRange();
const Comparator$1 = requireComparator();
const { ANY } = Comparator$1;
const satisfies$1 = satisfies_1;
const compare$1 = compare_1;
const subset$1 = (sub, dom, options = {}) => {
  if (sub === dom) {
    return true;
  }
  sub = new Range$1(sub, options);
  dom = new Range$1(dom, options);
  let sawNonNull = false;
  OUTER: for (const simpleSub of sub.set) {
    for (const simpleDom of dom.set) {
      const isSub = simpleSubset(simpleSub, simpleDom, options);
      sawNonNull = sawNonNull || isSub !== null;
      if (isSub) {
        continue OUTER;
      }
    }
    if (sawNonNull) {
      return false;
    }
  }
  return true;
};
const minimumVersionWithPreRelease = [new Comparator$1(">=0.0.0-0")];
const minimumVersion = [new Comparator$1(">=0.0.0")];
const simpleSubset = (sub, dom, options) => {
  if (sub === dom) {
    return true;
  }
  if (sub.length === 1 && sub[0].semver === ANY) {
    if (dom.length === 1 && dom[0].semver === ANY) {
      return true;
    } else if (options.includePrerelease) {
      sub = minimumVersionWithPreRelease;
    } else {
      sub = minimumVersion;
    }
  }
  if (dom.length === 1 && dom[0].semver === ANY) {
    if (options.includePrerelease) {
      return true;
    } else {
      dom = minimumVersion;
    }
  }
  const eqSet = /* @__PURE__ */ new Set();
  let gt2, lt2;
  for (const c of sub) {
    if (c.operator === ">" || c.operator === ">=") {
      gt2 = higherGT(gt2, c, options);
    } else if (c.operator === "<" || c.operator === "<=") {
      lt2 = lowerLT(lt2, c, options);
    } else {
      eqSet.add(c.semver);
    }
  }
  if (eqSet.size > 1) {
    return null;
  }
  let gtltComp;
  if (gt2 && lt2) {
    gtltComp = compare$1(gt2.semver, lt2.semver, options);
    if (gtltComp > 0) {
      return null;
    } else if (gtltComp === 0 && (gt2.operator !== ">=" || lt2.operator !== "<=")) {
      return null;
    }
  }
  for (const eq2 of eqSet) {
    if (gt2 && !satisfies$1(eq2, String(gt2), options)) {
      return null;
    }
    if (lt2 && !satisfies$1(eq2, String(lt2), options)) {
      return null;
    }
    for (const c of dom) {
      if (!satisfies$1(eq2, String(c), options)) {
        return false;
      }
    }
    return true;
  }
  let higher, lower;
  let hasDomLT, hasDomGT;
  let needDomLTPre = lt2 && !options.includePrerelease && lt2.semver.prerelease.length ? lt2.semver : false;
  let needDomGTPre = gt2 && !options.includePrerelease && gt2.semver.prerelease.length ? gt2.semver : false;
  if (needDomLTPre && needDomLTPre.prerelease.length === 1 && lt2.operator === "<" && needDomLTPre.prerelease[0] === 0) {
    needDomLTPre = false;
  }
  for (const c of dom) {
    hasDomGT = hasDomGT || c.operator === ">" || c.operator === ">=";
    hasDomLT = hasDomLT || c.operator === "<" || c.operator === "<=";
    if (gt2) {
      if (needDomGTPre) {
        if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomGTPre.major && c.semver.minor === needDomGTPre.minor && c.semver.patch === needDomGTPre.patch) {
          needDomGTPre = false;
        }
      }
      if (c.operator === ">" || c.operator === ">=") {
        higher = higherGT(gt2, c, options);
        if (higher === c && higher !== gt2) {
          return false;
        }
      } else if (gt2.operator === ">=" && !c.test(gt2.semver)) {
        return false;
      }
    }
    if (lt2) {
      if (needDomLTPre) {
        if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomLTPre.major && c.semver.minor === needDomLTPre.minor && c.semver.patch === needDomLTPre.patch) {
          needDomLTPre = false;
        }
      }
      if (c.operator === "<" || c.operator === "<=") {
        lower = lowerLT(lt2, c, options);
        if (lower === c && lower !== lt2) {
          return false;
        }
      } else if (lt2.operator === "<=" && !c.test(lt2.semver)) {
        return false;
      }
    }
    if (!c.operator && (lt2 || gt2) && gtltComp !== 0) {
      return false;
    }
  }
  if (gt2 && hasDomLT && !lt2 && gtltComp !== 0) {
    return false;
  }
  if (lt2 && hasDomGT && !gt2 && gtltComp !== 0) {
    return false;
  }
  if (needDomGTPre || needDomLTPre) {
    return false;
  }
  return true;
};
const higherGT = (a, b, options) => {
  if (!a) {
    return b;
  }
  const comp = compare$1(a.semver, b.semver, options);
  return comp > 0 ? a : comp < 0 ? b : b.operator === ">" && a.operator === ">=" ? b : a;
};
const lowerLT = (a, b, options) => {
  if (!a) {
    return b;
  }
  const comp = compare$1(a.semver, b.semver, options);
  return comp < 0 ? a : comp > 0 ? b : b.operator === "<" && a.operator === "<=" ? b : a;
};
var subset_1 = subset$1;
const internalRe = reExports;
const constants = constants$2;
const SemVer2 = semver$4;
const identifiers = identifiers$1;
const parse = parse_1;
const valid = valid_1;
const clean = clean_1;
const inc = inc_1;
const diff = diff_1;
const major = major_1;
const minor = minor_1;
const patch = patch_1;
const prerelease = prerelease_1;
const compare = compare_1;
const rcompare = rcompare_1;
const compareLoose = compareLoose_1;
const compareBuild = compareBuild_1;
const sort = sort_1;
const rsort = rsort_1;
const gt = gt_1;
const lt = lt_1;
const eq = eq_1;
const neq = neq_1;
const gte = gte_1;
const lte = lte_1;
const cmp = cmp_1;
const coerce = coerce_1;
const truncate = truncate_1;
const Comparator = requireComparator();
const Range = requireRange();
const satisfies = satisfies_1;
const toComparators = toComparators_1;
const maxSatisfying = maxSatisfying_1;
const minSatisfying = minSatisfying_1;
const minVersion = minVersion_1;
const validRange = valid$1;
const outside = outside_1;
const gtr = gtr_1;
const ltr = ltr_1;
const intersects = intersects_1;
const simplifyRange = simplify;
const subset = subset_1;
var semver$3 = {
  parse,
  valid,
  clean,
  inc,
  diff,
  major,
  minor,
  patch,
  prerelease,
  compare,
  rcompare,
  compareLoose,
  compareBuild,
  sort,
  rsort,
  gt,
  lt,
  eq,
  neq,
  gte,
  lte,
  cmp,
  coerce,
  truncate,
  Comparator,
  Range,
  satisfies,
  toComparators,
  maxSatisfying,
  minSatisfying,
  minVersion,
  validRange,
  outside,
  gtr,
  ltr,
  intersects,
  simplifyRange,
  subset,
  SemVer: SemVer2,
  re: internalRe.re,
  src: internalRe.src,
  tokens: internalRe.t,
  SEMVER_SPEC_VERSION: constants.SEMVER_SPEC_VERSION,
  RELEASE_TYPES: constants.RELEASE_TYPES,
  compareIdentifiers: identifiers.compareIdentifiers,
  rcompareIdentifiers: identifiers.rcompareIdentifiers
};
const semver$2 = semver$3;
var asymmetricKeyDetailsSupported = semver$2.satisfies(process.version, ">=15.7.0");
const semver$1 = semver$3;
var rsaPssKeyDetailsSupported = semver$1.satisfies(process.version, ">=16.9.0");
const ASYMMETRIC_KEY_DETAILS_SUPPORTED = asymmetricKeyDetailsSupported;
const RSA_PSS_KEY_DETAILS_SUPPORTED = rsaPssKeyDetailsSupported;
const allowedAlgorithmsForKeys = {
  "ec": ["ES256", "ES384", "ES512"],
  "rsa": ["RS256", "PS256", "RS384", "PS384", "RS512", "PS512"],
  "rsa-pss": ["PS256", "PS384", "PS512"]
};
const allowedCurves = {
  ES256: "prime256v1",
  ES384: "secp384r1",
  ES512: "secp521r1"
};
var validateAsymmetricKey$2 = function(algorithm, key) {
  if (!algorithm || !key) return;
  const keyType = key.asymmetricKeyType;
  if (!keyType) return;
  const allowedAlgorithms = allowedAlgorithmsForKeys[keyType];
  if (!allowedAlgorithms) {
    throw new Error(`Unknown key type "${keyType}".`);
  }
  if (!allowedAlgorithms.includes(algorithm)) {
    throw new Error(`"alg" parameter for "${keyType}" key type must be one of: ${allowedAlgorithms.join(", ")}.`);
  }
  if (ASYMMETRIC_KEY_DETAILS_SUPPORTED) {
    switch (keyType) {
      case "ec":
        const keyCurve = key.asymmetricKeyDetails.namedCurve;
        const allowedCurve = allowedCurves[algorithm];
        if (keyCurve !== allowedCurve) {
          throw new Error(`"alg" parameter "${algorithm}" requires curve "${allowedCurve}".`);
        }
        break;
      case "rsa-pss":
        if (RSA_PSS_KEY_DETAILS_SUPPORTED) {
          const length = parseInt(algorithm.slice(-3), 10);
          const { hashAlgorithm, mgf1HashAlgorithm, saltLength } = key.asymmetricKeyDetails;
          if (hashAlgorithm !== `sha${length}` || mgf1HashAlgorithm !== hashAlgorithm) {
            throw new Error(`Invalid key for this operation, its RSA-PSS parameters do not meet the requirements of "alg" ${algorithm}.`);
          }
          if (saltLength !== void 0 && saltLength > length >> 3) {
            throw new Error(`Invalid key for this operation, its RSA-PSS parameter saltLength does not meet the requirements of "alg" ${algorithm}.`);
          }
        }
        break;
    }
  }
};
var semver = semver$3;
var psSupported = semver.satisfies(process.version, "^6.12.0 || >=8.0.0");
const JsonWebTokenError = JsonWebTokenError_1;
const NotBeforeError = NotBeforeError_1;
const TokenExpiredError = TokenExpiredError_1;
const decode = decode$1;
const timespan$1 = timespan$2;
const validateAsymmetricKey$1 = validateAsymmetricKey$2;
const PS_SUPPORTED$1 = psSupported;
const jws$1 = jws$3;
const { KeyObject: KeyObject$1, createSecretKey: createSecretKey$1, createPublicKey } = require$$1;
const PUB_KEY_ALGS = ["RS256", "RS384", "RS512"];
const EC_KEY_ALGS = ["ES256", "ES384", "ES512"];
const RSA_KEY_ALGS = ["RS256", "RS384", "RS512"];
const HS_ALGS = ["HS256", "HS384", "HS512"];
if (PS_SUPPORTED$1) {
  PUB_KEY_ALGS.splice(PUB_KEY_ALGS.length, 0, "PS256", "PS384", "PS512");
  RSA_KEY_ALGS.splice(RSA_KEY_ALGS.length, 0, "PS256", "PS384", "PS512");
}
var verify2 = function(jwtString, secretOrPublicKey, options, callback) {
  if (typeof options === "function" && !callback) {
    callback = options;
    options = {};
  }
  if (!options) {
    options = {};
  }
  options = Object.assign({}, options);
  let done;
  if (callback) {
    done = callback;
  } else {
    done = function(err, data) {
      if (err) throw err;
      return data;
    };
  }
  if (options.clockTimestamp && typeof options.clockTimestamp !== "number") {
    return done(new JsonWebTokenError("clockTimestamp must be a number"));
  }
  if (options.nonce !== void 0 && (typeof options.nonce !== "string" || options.nonce.trim() === "")) {
    return done(new JsonWebTokenError("nonce must be a non-empty string"));
  }
  if (options.allowInvalidAsymmetricKeyTypes !== void 0 && typeof options.allowInvalidAsymmetricKeyTypes !== "boolean") {
    return done(new JsonWebTokenError("allowInvalidAsymmetricKeyTypes must be a boolean"));
  }
  const clockTimestamp = options.clockTimestamp || Math.floor(Date.now() / 1e3);
  if (!jwtString) {
    return done(new JsonWebTokenError("jwt must be provided"));
  }
  if (typeof jwtString !== "string") {
    return done(new JsonWebTokenError("jwt must be a string"));
  }
  const parts = jwtString.split(".");
  if (parts.length !== 3) {
    return done(new JsonWebTokenError("jwt malformed"));
  }
  let decodedToken;
  try {
    decodedToken = decode(jwtString, { complete: true });
  } catch (err) {
    return done(err);
  }
  if (!decodedToken) {
    return done(new JsonWebTokenError("invalid token"));
  }
  const header = decodedToken.header;
  let getSecret;
  if (typeof secretOrPublicKey === "function") {
    if (!callback) {
      return done(new JsonWebTokenError("verify must be called asynchronous if secret or public key is provided as a callback"));
    }
    getSecret = secretOrPublicKey;
  } else {
    getSecret = function(header2, secretCallback) {
      return secretCallback(null, secretOrPublicKey);
    };
  }
  return getSecret(header, function(err, secretOrPublicKey2) {
    if (err) {
      return done(new JsonWebTokenError("error in secret or public key callback: " + err.message));
    }
    const hasSignature = parts[2].trim() !== "";
    if (!hasSignature && secretOrPublicKey2) {
      return done(new JsonWebTokenError("jwt signature is required"));
    }
    if (hasSignature && !secretOrPublicKey2) {
      return done(new JsonWebTokenError("secret or public key must be provided"));
    }
    if (!hasSignature && !options.algorithms) {
      return done(new JsonWebTokenError('please specify "none" in "algorithms" to verify unsigned tokens'));
    }
    if (secretOrPublicKey2 != null && !(secretOrPublicKey2 instanceof KeyObject$1)) {
      try {
        secretOrPublicKey2 = createPublicKey(secretOrPublicKey2);
      } catch (_) {
        try {
          secretOrPublicKey2 = createSecretKey$1(typeof secretOrPublicKey2 === "string" ? Buffer.from(secretOrPublicKey2) : secretOrPublicKey2);
        } catch (_2) {
          return done(new JsonWebTokenError("secretOrPublicKey is not valid key material"));
        }
      }
    }
    if (!options.algorithms) {
      if (secretOrPublicKey2.type === "secret") {
        options.algorithms = HS_ALGS;
      } else if (["rsa", "rsa-pss"].includes(secretOrPublicKey2.asymmetricKeyType)) {
        options.algorithms = RSA_KEY_ALGS;
      } else if (secretOrPublicKey2.asymmetricKeyType === "ec") {
        options.algorithms = EC_KEY_ALGS;
      } else {
        options.algorithms = PUB_KEY_ALGS;
      }
    }
    if (options.algorithms.indexOf(decodedToken.header.alg) === -1) {
      return done(new JsonWebTokenError("invalid algorithm"));
    }
    if (header.alg.startsWith("HS") && secretOrPublicKey2.type !== "secret") {
      return done(new JsonWebTokenError(`secretOrPublicKey must be a symmetric key when using ${header.alg}`));
    } else if (/^(?:RS|PS|ES)/.test(header.alg) && secretOrPublicKey2.type !== "public") {
      return done(new JsonWebTokenError(`secretOrPublicKey must be an asymmetric key when using ${header.alg}`));
    }
    if (!options.allowInvalidAsymmetricKeyTypes) {
      try {
        validateAsymmetricKey$1(header.alg, secretOrPublicKey2);
      } catch (e) {
        return done(e);
      }
    }
    let valid2;
    try {
      valid2 = jws$1.verify(jwtString, decodedToken.header.alg, secretOrPublicKey2);
    } catch (e) {
      return done(e);
    }
    if (!valid2) {
      return done(new JsonWebTokenError("invalid signature"));
    }
    const payload = decodedToken.payload;
    if (typeof payload.nbf !== "undefined" && !options.ignoreNotBefore) {
      if (typeof payload.nbf !== "number") {
        return done(new JsonWebTokenError("invalid nbf value"));
      }
      if (payload.nbf > clockTimestamp + (options.clockTolerance || 0)) {
        return done(new NotBeforeError("jwt not active", new Date(payload.nbf * 1e3)));
      }
    }
    if (typeof payload.exp !== "undefined" && !options.ignoreExpiration) {
      if (typeof payload.exp !== "number") {
        return done(new JsonWebTokenError("invalid exp value"));
      }
      if (clockTimestamp >= payload.exp + (options.clockTolerance || 0)) {
        return done(new TokenExpiredError("jwt expired", new Date(payload.exp * 1e3)));
      }
    }
    if (options.audience) {
      const audiences = Array.isArray(options.audience) ? options.audience : [options.audience];
      const target = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      const match = target.some(function(targetAudience) {
        return audiences.some(function(audience) {
          return audience instanceof RegExp ? audience.test(targetAudience) : audience === targetAudience;
        });
      });
      if (!match) {
        return done(new JsonWebTokenError("jwt audience invalid. expected: " + audiences.join(" or ")));
      }
    }
    if (options.issuer) {
      const invalid_issuer = typeof options.issuer === "string" && payload.iss !== options.issuer || Array.isArray(options.issuer) && options.issuer.indexOf(payload.iss) === -1;
      if (invalid_issuer) {
        return done(new JsonWebTokenError("jwt issuer invalid. expected: " + options.issuer));
      }
    }
    if (options.subject) {
      if (payload.sub !== options.subject) {
        return done(new JsonWebTokenError("jwt subject invalid. expected: " + options.subject));
      }
    }
    if (options.jwtid) {
      if (payload.jti !== options.jwtid) {
        return done(new JsonWebTokenError("jwt jwtid invalid. expected: " + options.jwtid));
      }
    }
    if (options.nonce) {
      if (payload.nonce !== options.nonce) {
        return done(new JsonWebTokenError("jwt nonce invalid. expected: " + options.nonce));
      }
    }
    if (options.maxAge) {
      if (typeof payload.iat !== "number") {
        return done(new JsonWebTokenError("iat required when maxAge is specified"));
      }
      const maxAgeTimestamp = timespan$1(options.maxAge, payload.iat);
      if (typeof maxAgeTimestamp === "undefined") {
        return done(new JsonWebTokenError('"maxAge" should be a number of seconds or string representing a timespan eg: "1d", "20h", 60'));
      }
      if (clockTimestamp >= maxAgeTimestamp + (options.clockTolerance || 0)) {
        return done(new TokenExpiredError("maxAge exceeded", new Date(maxAgeTimestamp * 1e3)));
      }
    }
    if (options.complete === true) {
      const signature = decodedToken.signature;
      return done(null, {
        header,
        payload,
        signature
      });
    }
    return done(null, payload);
  });
};
var INFINITY$2 = 1 / 0, MAX_SAFE_INTEGER = 9007199254740991, MAX_INTEGER$2 = 17976931348623157e292, NAN$2 = 0 / 0;
var argsTag = "[object Arguments]", funcTag = "[object Function]", genTag = "[object GeneratorFunction]", stringTag$1 = "[object String]", symbolTag$2 = "[object Symbol]";
var reTrim$2 = /^\s+|\s+$/g;
var reIsBadHex$2 = /^[-+]0x[0-9a-f]+$/i;
var reIsBinary$2 = /^0b[01]+$/i;
var reIsOctal$2 = /^0o[0-7]+$/i;
var reIsUint = /^(?:0|[1-9]\d*)$/;
var freeParseInt$2 = parseInt;
function arrayMap(array, iteratee) {
  var index = -1, length = array ? array.length : 0, result = Array(length);
  while (++index < length) {
    result[index] = iteratee(array[index], index, array);
  }
  return result;
}
function baseFindIndex(array, predicate, fromIndex, fromRight) {
  var length = array.length, index = fromIndex + -1;
  while (++index < length) {
    if (predicate(array[index], index, array)) {
      return index;
    }
  }
  return -1;
}
function baseIndexOf(array, value, fromIndex) {
  if (value !== value) {
    return baseFindIndex(array, baseIsNaN, fromIndex);
  }
  var index = fromIndex - 1, length = array.length;
  while (++index < length) {
    if (array[index] === value) {
      return index;
    }
  }
  return -1;
}
function baseIsNaN(value) {
  return value !== value;
}
function baseTimes(n, iteratee) {
  var index = -1, result = Array(n);
  while (++index < n) {
    result[index] = iteratee(index);
  }
  return result;
}
function baseValues(object, props) {
  return arrayMap(props, function(key) {
    return object[key];
  });
}
function overArg$1(func, transform) {
  return function(arg) {
    return func(transform(arg));
  };
}
var objectProto$6 = Object.prototype;
var hasOwnProperty$1 = objectProto$6.hasOwnProperty;
var objectToString$6 = objectProto$6.toString;
var propertyIsEnumerable = objectProto$6.propertyIsEnumerable;
var nativeKeys = overArg$1(Object.keys, Object), nativeMax = Math.max;
function arrayLikeKeys(value, inherited) {
  var result = isArray$1(value) || isArguments(value) ? baseTimes(value.length, String) : [];
  var length = result.length, skipIndexes = !!length;
  for (var key in value) {
    if (hasOwnProperty$1.call(value, key) && !(skipIndexes && (key == "length" || isIndex(key, length)))) {
      result.push(key);
    }
  }
  return result;
}
function baseKeys(object) {
  if (!isPrototype(object)) {
    return nativeKeys(object);
  }
  var result = [];
  for (var key in Object(object)) {
    if (hasOwnProperty$1.call(object, key) && key != "constructor") {
      result.push(key);
    }
  }
  return result;
}
function isIndex(value, length) {
  length = length == null ? MAX_SAFE_INTEGER : length;
  return !!length && (typeof value == "number" || reIsUint.test(value)) && (value > -1 && value % 1 == 0 && value < length);
}
function isPrototype(value) {
  var Ctor = value && value.constructor, proto = typeof Ctor == "function" && Ctor.prototype || objectProto$6;
  return value === proto;
}
function includes$1(collection, value, fromIndex, guard) {
  collection = isArrayLike(collection) ? collection : values(collection);
  fromIndex = fromIndex && !guard ? toInteger$2(fromIndex) : 0;
  var length = collection.length;
  if (fromIndex < 0) {
    fromIndex = nativeMax(length + fromIndex, 0);
  }
  return isString$2(collection) ? fromIndex <= length && collection.indexOf(value, fromIndex) > -1 : !!length && baseIndexOf(collection, value, fromIndex) > -1;
}
function isArguments(value) {
  return isArrayLikeObject(value) && hasOwnProperty$1.call(value, "callee") && (!propertyIsEnumerable.call(value, "callee") || objectToString$6.call(value) == argsTag);
}
var isArray$1 = Array.isArray;
function isArrayLike(value) {
  return value != null && isLength(value.length) && !isFunction(value);
}
function isArrayLikeObject(value) {
  return isObjectLike$6(value) && isArrayLike(value);
}
function isFunction(value) {
  var tag = isObject$2(value) ? objectToString$6.call(value) : "";
  return tag == funcTag || tag == genTag;
}
function isLength(value) {
  return typeof value == "number" && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
}
function isObject$2(value) {
  var type = typeof value;
  return !!value && (type == "object" || type == "function");
}
function isObjectLike$6(value) {
  return !!value && typeof value == "object";
}
function isString$2(value) {
  return typeof value == "string" || !isArray$1(value) && isObjectLike$6(value) && objectToString$6.call(value) == stringTag$1;
}
function isSymbol$2(value) {
  return typeof value == "symbol" || isObjectLike$6(value) && objectToString$6.call(value) == symbolTag$2;
}
function toFinite$2(value) {
  if (!value) {
    return value === 0 ? value : 0;
  }
  value = toNumber$2(value);
  if (value === INFINITY$2 || value === -INFINITY$2) {
    var sign3 = value < 0 ? -1 : 1;
    return sign3 * MAX_INTEGER$2;
  }
  return value === value ? value : 0;
}
function toInteger$2(value) {
  var result = toFinite$2(value), remainder = result % 1;
  return result === result ? remainder ? result - remainder : result : 0;
}
function toNumber$2(value) {
  if (typeof value == "number") {
    return value;
  }
  if (isSymbol$2(value)) {
    return NAN$2;
  }
  if (isObject$2(value)) {
    var other = typeof value.valueOf == "function" ? value.valueOf() : value;
    value = isObject$2(other) ? other + "" : other;
  }
  if (typeof value != "string") {
    return value === 0 ? value : +value;
  }
  value = value.replace(reTrim$2, "");
  var isBinary = reIsBinary$2.test(value);
  return isBinary || reIsOctal$2.test(value) ? freeParseInt$2(value.slice(2), isBinary ? 2 : 8) : reIsBadHex$2.test(value) ? NAN$2 : +value;
}
function keys(object) {
  return isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);
}
function values(object) {
  return object ? baseValues(object, keys(object)) : [];
}
var lodash_includes = includes$1;
var boolTag = "[object Boolean]";
var objectProto$5 = Object.prototype;
var objectToString$5 = objectProto$5.toString;
function isBoolean$1(value) {
  return value === true || value === false || isObjectLike$5(value) && objectToString$5.call(value) == boolTag;
}
function isObjectLike$5(value) {
  return !!value && typeof value == "object";
}
var lodash_isboolean = isBoolean$1;
var INFINITY$1 = 1 / 0, MAX_INTEGER$1 = 17976931348623157e292, NAN$1 = 0 / 0;
var symbolTag$1 = "[object Symbol]";
var reTrim$1 = /^\s+|\s+$/g;
var reIsBadHex$1 = /^[-+]0x[0-9a-f]+$/i;
var reIsBinary$1 = /^0b[01]+$/i;
var reIsOctal$1 = /^0o[0-7]+$/i;
var freeParseInt$1 = parseInt;
var objectProto$4 = Object.prototype;
var objectToString$4 = objectProto$4.toString;
function isInteger$1(value) {
  return typeof value == "number" && value == toInteger$1(value);
}
function isObject$1(value) {
  var type = typeof value;
  return !!value && (type == "object" || type == "function");
}
function isObjectLike$4(value) {
  return !!value && typeof value == "object";
}
function isSymbol$1(value) {
  return typeof value == "symbol" || isObjectLike$4(value) && objectToString$4.call(value) == symbolTag$1;
}
function toFinite$1(value) {
  if (!value) {
    return value === 0 ? value : 0;
  }
  value = toNumber$1(value);
  if (value === INFINITY$1 || value === -INFINITY$1) {
    var sign3 = value < 0 ? -1 : 1;
    return sign3 * MAX_INTEGER$1;
  }
  return value === value ? value : 0;
}
function toInteger$1(value) {
  var result = toFinite$1(value), remainder = result % 1;
  return result === result ? remainder ? result - remainder : result : 0;
}
function toNumber$1(value) {
  if (typeof value == "number") {
    return value;
  }
  if (isSymbol$1(value)) {
    return NAN$1;
  }
  if (isObject$1(value)) {
    var other = typeof value.valueOf == "function" ? value.valueOf() : value;
    value = isObject$1(other) ? other + "" : other;
  }
  if (typeof value != "string") {
    return value === 0 ? value : +value;
  }
  value = value.replace(reTrim$1, "");
  var isBinary = reIsBinary$1.test(value);
  return isBinary || reIsOctal$1.test(value) ? freeParseInt$1(value.slice(2), isBinary ? 2 : 8) : reIsBadHex$1.test(value) ? NAN$1 : +value;
}
var lodash_isinteger = isInteger$1;
var numberTag = "[object Number]";
var objectProto$3 = Object.prototype;
var objectToString$3 = objectProto$3.toString;
function isObjectLike$3(value) {
  return !!value && typeof value == "object";
}
function isNumber$1(value) {
  return typeof value == "number" || isObjectLike$3(value) && objectToString$3.call(value) == numberTag;
}
var lodash_isnumber = isNumber$1;
var objectTag = "[object Object]";
function isHostObject(value) {
  var result = false;
  if (value != null && typeof value.toString != "function") {
    try {
      result = !!(value + "");
    } catch (e) {
    }
  }
  return result;
}
function overArg(func, transform) {
  return function(arg) {
    return func(transform(arg));
  };
}
var funcProto = Function.prototype, objectProto$2 = Object.prototype;
var funcToString = funcProto.toString;
var hasOwnProperty = objectProto$2.hasOwnProperty;
var objectCtorString = funcToString.call(Object);
var objectToString$2 = objectProto$2.toString;
var getPrototype = overArg(Object.getPrototypeOf, Object);
function isObjectLike$2(value) {
  return !!value && typeof value == "object";
}
function isPlainObject$1(value) {
  if (!isObjectLike$2(value) || objectToString$2.call(value) != objectTag || isHostObject(value)) {
    return false;
  }
  var proto = getPrototype(value);
  if (proto === null) {
    return true;
  }
  var Ctor = hasOwnProperty.call(proto, "constructor") && proto.constructor;
  return typeof Ctor == "function" && Ctor instanceof Ctor && funcToString.call(Ctor) == objectCtorString;
}
var lodash_isplainobject = isPlainObject$1;
var stringTag = "[object String]";
var objectProto$1 = Object.prototype;
var objectToString$1 = objectProto$1.toString;
var isArray = Array.isArray;
function isObjectLike$1(value) {
  return !!value && typeof value == "object";
}
function isString$1(value) {
  return typeof value == "string" || !isArray(value) && isObjectLike$1(value) && objectToString$1.call(value) == stringTag;
}
var lodash_isstring = isString$1;
var FUNC_ERROR_TEXT = "Expected a function";
var INFINITY = 1 / 0, MAX_INTEGER = 17976931348623157e292, NAN = 0 / 0;
var symbolTag = "[object Symbol]";
var reTrim = /^\s+|\s+$/g;
var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;
var reIsBinary = /^0b[01]+$/i;
var reIsOctal = /^0o[0-7]+$/i;
var freeParseInt = parseInt;
var objectProto = Object.prototype;
var objectToString = objectProto.toString;
function before(n, func) {
  var result;
  if (typeof func != "function") {
    throw new TypeError(FUNC_ERROR_TEXT);
  }
  n = toInteger(n);
  return function() {
    if (--n > 0) {
      result = func.apply(this, arguments);
    }
    if (n <= 1) {
      func = void 0;
    }
    return result;
  };
}
function once$1(func) {
  return before(2, func);
}
function isObject(value) {
  var type = typeof value;
  return !!value && (type == "object" || type == "function");
}
function isObjectLike(value) {
  return !!value && typeof value == "object";
}
function isSymbol(value) {
  return typeof value == "symbol" || isObjectLike(value) && objectToString.call(value) == symbolTag;
}
function toFinite(value) {
  if (!value) {
    return value === 0 ? value : 0;
  }
  value = toNumber(value);
  if (value === INFINITY || value === -INFINITY) {
    var sign3 = value < 0 ? -1 : 1;
    return sign3 * MAX_INTEGER;
  }
  return value === value ? value : 0;
}
function toInteger(value) {
  var result = toFinite(value), remainder = result % 1;
  return result === result ? remainder ? result - remainder : result : 0;
}
function toNumber(value) {
  if (typeof value == "number") {
    return value;
  }
  if (isSymbol(value)) {
    return NAN;
  }
  if (isObject(value)) {
    var other = typeof value.valueOf == "function" ? value.valueOf() : value;
    value = isObject(other) ? other + "" : other;
  }
  if (typeof value != "string") {
    return value === 0 ? value : +value;
  }
  value = value.replace(reTrim, "");
  var isBinary = reIsBinary.test(value);
  return isBinary || reIsOctal.test(value) ? freeParseInt(value.slice(2), isBinary ? 2 : 8) : reIsBadHex.test(value) ? NAN : +value;
}
var lodash_once = once$1;
const timespan = timespan$2;
const PS_SUPPORTED = psSupported;
const validateAsymmetricKey = validateAsymmetricKey$2;
const jws = jws$3;
const includes = lodash_includes;
const isBoolean = lodash_isboolean;
const isInteger = lodash_isinteger;
const isNumber = lodash_isnumber;
const isPlainObject = lodash_isplainobject;
const isString = lodash_isstring;
const once = lodash_once;
const { KeyObject, createSecretKey, createPrivateKey } = require$$1;
const SUPPORTED_ALGS = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "HS256", "HS384", "HS512", "none"];
if (PS_SUPPORTED) {
  SUPPORTED_ALGS.splice(3, 0, "PS256", "PS384", "PS512");
}
const sign_options_schema = {
  expiresIn: { isValid: function(value) {
    return isInteger(value) || isString(value) && value;
  }, message: '"expiresIn" should be a number of seconds or string representing a timespan' },
  notBefore: { isValid: function(value) {
    return isInteger(value) || isString(value) && value;
  }, message: '"notBefore" should be a number of seconds or string representing a timespan' },
  audience: { isValid: function(value) {
    return isString(value) || Array.isArray(value);
  }, message: '"audience" must be a string or array' },
  algorithm: { isValid: includes.bind(null, SUPPORTED_ALGS), message: '"algorithm" must be a valid string enum value' },
  header: { isValid: isPlainObject, message: '"header" must be an object' },
  encoding: { isValid: isString, message: '"encoding" must be a string' },
  issuer: { isValid: isString, message: '"issuer" must be a string' },
  subject: { isValid: isString, message: '"subject" must be a string' },
  jwtid: { isValid: isString, message: '"jwtid" must be a string' },
  noTimestamp: { isValid: isBoolean, message: '"noTimestamp" must be a boolean' },
  keyid: { isValid: isString, message: '"keyid" must be a string' },
  mutatePayload: { isValid: isBoolean, message: '"mutatePayload" must be a boolean' },
  allowInsecureKeySizes: { isValid: isBoolean, message: '"allowInsecureKeySizes" must be a boolean' },
  allowInvalidAsymmetricKeyTypes: { isValid: isBoolean, message: '"allowInvalidAsymmetricKeyTypes" must be a boolean' }
};
const registered_claims_schema = {
  iat: { isValid: isNumber, message: '"iat" should be a number of seconds' },
  exp: { isValid: isNumber, message: '"exp" should be a number of seconds' },
  nbf: { isValid: isNumber, message: '"nbf" should be a number of seconds' }
};
function validate(schema, allowUnknown, object, parameterName) {
  if (!isPlainObject(object)) {
    throw new Error('Expected "' + parameterName + '" to be a plain object.');
  }
  Object.keys(object).forEach(function(key) {
    const validator = schema[key];
    if (!validator) {
      if (!allowUnknown) {
        throw new Error('"' + key + '" is not allowed in "' + parameterName + '"');
      }
      return;
    }
    if (!validator.isValid(object[key])) {
      throw new Error(validator.message);
    }
  });
}
function validateOptions(options) {
  return validate(sign_options_schema, false, options, "options");
}
function validatePayload(payload) {
  return validate(registered_claims_schema, true, payload, "payload");
}
const options_to_payload = {
  "audience": "aud",
  "issuer": "iss",
  "subject": "sub",
  "jwtid": "jti"
};
const options_for_objects = [
  "expiresIn",
  "notBefore",
  "noTimestamp",
  "audience",
  "issuer",
  "subject",
  "jwtid"
];
var sign2 = function(payload, secretOrPrivateKey, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  } else {
    options = options || {};
  }
  const isObjectPayload = typeof payload === "object" && !Buffer.isBuffer(payload);
  const header = Object.assign({
    alg: options.algorithm || "HS256",
    typ: isObjectPayload ? "JWT" : void 0,
    kid: options.keyid
  }, options.header);
  function failure(err) {
    if (callback) {
      return callback(err);
    }
    throw err;
  }
  if (!secretOrPrivateKey && options.algorithm !== "none") {
    return failure(new Error("secretOrPrivateKey must have a value"));
  }
  if (secretOrPrivateKey != null && !(secretOrPrivateKey instanceof KeyObject)) {
    try {
      secretOrPrivateKey = createPrivateKey(secretOrPrivateKey);
    } catch (_) {
      try {
        secretOrPrivateKey = createSecretKey(typeof secretOrPrivateKey === "string" ? Buffer.from(secretOrPrivateKey) : secretOrPrivateKey);
      } catch (_2) {
        return failure(new Error("secretOrPrivateKey is not valid key material"));
      }
    }
  }
  if (header.alg.startsWith("HS") && secretOrPrivateKey.type !== "secret") {
    return failure(new Error(`secretOrPrivateKey must be a symmetric key when using ${header.alg}`));
  } else if (/^(?:RS|PS|ES)/.test(header.alg)) {
    if (secretOrPrivateKey.type !== "private") {
      return failure(new Error(`secretOrPrivateKey must be an asymmetric key when using ${header.alg}`));
    }
    if (!options.allowInsecureKeySizes && !header.alg.startsWith("ES") && secretOrPrivateKey.asymmetricKeyDetails !== void 0 && //KeyObject.asymmetricKeyDetails is supported in Node 15+
    secretOrPrivateKey.asymmetricKeyDetails.modulusLength < 2048) {
      return failure(new Error(`secretOrPrivateKey has a minimum key size of 2048 bits for ${header.alg}`));
    }
  }
  if (typeof payload === "undefined") {
    return failure(new Error("payload is required"));
  } else if (isObjectPayload) {
    try {
      validatePayload(payload);
    } catch (error) {
      return failure(error);
    }
    if (!options.mutatePayload) {
      payload = Object.assign({}, payload);
    }
  } else {
    const invalid_options = options_for_objects.filter(function(opt) {
      return typeof options[opt] !== "undefined";
    });
    if (invalid_options.length > 0) {
      return failure(new Error("invalid " + invalid_options.join(",") + " option for " + typeof payload + " payload"));
    }
  }
  if (typeof payload.exp !== "undefined" && typeof options.expiresIn !== "undefined") {
    return failure(new Error('Bad "options.expiresIn" option the payload already has an "exp" property.'));
  }
  if (typeof payload.nbf !== "undefined" && typeof options.notBefore !== "undefined") {
    return failure(new Error('Bad "options.notBefore" option the payload already has an "nbf" property.'));
  }
  try {
    validateOptions(options);
  } catch (error) {
    return failure(error);
  }
  if (!options.allowInvalidAsymmetricKeyTypes) {
    try {
      validateAsymmetricKey(header.alg, secretOrPrivateKey);
    } catch (error) {
      return failure(error);
    }
  }
  const timestamp = payload.iat || Math.floor(Date.now() / 1e3);
  if (options.noTimestamp) {
    delete payload.iat;
  } else if (isObjectPayload) {
    payload.iat = timestamp;
  }
  if (typeof options.notBefore !== "undefined") {
    try {
      payload.nbf = timespan(options.notBefore, timestamp);
    } catch (err) {
      return failure(err);
    }
    if (typeof payload.nbf === "undefined") {
      return failure(new Error('"notBefore" should be a number of seconds or string representing a timespan eg: "1d", "20h", 60'));
    }
  }
  if (typeof options.expiresIn !== "undefined" && typeof payload === "object") {
    try {
      payload.exp = timespan(options.expiresIn, timestamp);
    } catch (err) {
      return failure(err);
    }
    if (typeof payload.exp === "undefined") {
      return failure(new Error('"expiresIn" should be a number of seconds or string representing a timespan eg: "1d", "20h", 60'));
    }
  }
  Object.keys(options_to_payload).forEach(function(key) {
    const claim = options_to_payload[key];
    if (typeof options[key] !== "undefined") {
      if (typeof payload[claim] !== "undefined") {
        return failure(new Error('Bad "options.' + key + '" option. The payload already has an "' + claim + '" property.'));
      }
      payload[claim] = options[key];
    }
  });
  const encoding = options.encoding || "utf8";
  if (typeof callback === "function") {
    callback = callback && once(callback);
    jws.createSign({
      header,
      privateKey: secretOrPrivateKey,
      payload,
      encoding
    }).once("error", callback).once("done", function(signature) {
      if (!options.allowInsecureKeySizes && /^(?:RS|PS)/.test(header.alg) && signature.length < 256) {
        return callback(new Error(`secretOrPrivateKey has a minimum key size of 2048 bits for ${header.alg}`));
      }
      callback(null, signature);
    });
  } else {
    let signature = jws.sign({ header, payload, secret: secretOrPrivateKey, encoding });
    if (!options.allowInsecureKeySizes && /^(?:RS|PS)/.test(header.alg) && signature.length < 256) {
      throw new Error(`secretOrPrivateKey has a minimum key size of 2048 bits for ${header.alg}`);
    }
    return signature;
  }
};
var jsonwebtoken = {
  decode: decode$1,
  verify: verify2,
  sign: sign2,
  JsonWebTokenError: JsonWebTokenError_1,
  NotBeforeError: NotBeforeError_1,
  TokenExpiredError: TokenExpiredError_1
};
const jwt = /* @__PURE__ */ getDefaultExportFromCjs(jsonwebtoken);
const RESERVED_USERNAMES = [
  "admin",
  "root",
  "system",
  "guest",
  "test",
  "administrator"
];
const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{4,14}$/;
const PASSWORD_MIN_LENGTH = 8;
const IPC_CHANNELS = {
  // Auth
  AUTH_LOGIN: "auth:login",
  AUTH_REGISTER: "auth:register",
  AUTH_CHECK_USERNAME: "auth:check-username",
  AUTH_VALIDATE_TOKEN: "auth:validate-token",
  // Files
  FILE_CREATE: "file:create",
  FILE_SAVE: "file:save",
  FILE_DELETE: "file:delete",
  FILE_LIST: "file:list",
  FILE_GET: "file:get",
  // History
  HISTORY_LIST: "history:list",
  HISTORY_GET: "history:get",
  // Settings
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",
  // Export
  EXPORT_MD: "export:md",
  EXPORT_DOCX: "export:docx",
  EXPORT_PDF: "export:pdf",
  // Window
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_UNMAXIMIZE: "window:unmaximize",
  WINDOW_CLOSE: "window:close",
  WINDOW_IS_MAXIMIZED: "window:is-maximized",
  // Dialog
  DIALOG_OPEN_FILE: "dialog:open-file",
  DIALOG_SAVE_FILE: "dialog:save-file",
  // Account
  ACCOUNT_INFO: "account:info",
  ACCOUNT_DELETE: "account:delete",
  ACCOUNT_EXPORT: "account:export"
};
let db = null;
function getDbPath() {
  const userDataPath = electron.app.getPath("userData");
  return path.join(userDataPath, "weaveMD.db");
}
function initDatabase() {
  if (db) return db;
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}
function runMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      modified_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      diff TEXT,
      saved_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      theme TEXT DEFAULT 'dark',
      language TEXT DEFAULT 'zh-CN',
      custom_colors TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_files_user_modified ON files(user_id, modified_at);
    CREATE INDEX IF NOT EXISTS idx_history_file_saved ON history(file_id, saved_at);
    CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_id);
  `);
}
function getDatabase() {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
const BCRYPT_ROUNDS = 12;
function createUser(username, password) {
  const db2 = getDatabase();
  const normalized = username.toLowerCase();
  const existing = db2.prepare("SELECT id FROM users WHERE username = ?").get(normalized);
  if (existing) {
    return { success: false, message: "Username already taken" };
  }
  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const id = require$$1.randomUUID();
  try {
    db2.prepare(
      "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)"
    ).run(id, normalized, passwordHash);
    const settingsId = require$$1.randomUUID();
    db2.prepare(
      "INSERT INTO settings (id, user_id, theme, language) VALUES (?, ?, ?, ?)"
    ).run(settingsId, id, "dark", "zh-CN");
    return { success: true, message: "Account created successfully", userId: id };
  } catch (error) {
    console.error("Failed to create user:", error);
    return { success: false, message: "Failed to create account" };
  }
}
function findByUsername(username) {
  const db2 = getDatabase();
  return db2.prepare("SELECT * FROM users WHERE username = ?").get(username.toLowerCase());
}
function findById(userId) {
  const db2 = getDatabase();
  return db2.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}
function validateCredentials(username, password) {
  const user = findByUsername(username);
  if (!user) {
    return { success: false, message: "Invalid username or password" };
  }
  const valid2 = bcrypt.compareSync(password, user.password_hash);
  if (!valid2) {
    return { success: false, message: "Invalid username or password" };
  }
  const db2 = getDatabase();
  db2.prepare("UPDATE users SET last_login = datetime(?, ?) WHERE id = ?").run(
    "now",
    "localtime",
    user.id
  );
  const { password_hash, ...safeUser } = user;
  return { success: true, message: "Login successful", user: safeUser };
}
function isUsernameTaken(username) {
  const db2 = getDatabase();
  const row = db2.prepare("SELECT id FROM users WHERE username = ?").get(username.toLowerCase());
  return !!row;
}
function deleteUser(userId) {
  const db2 = getDatabase();
  try {
    db2.prepare("DELETE FROM settings WHERE user_id = ?").run(userId);
    db2.prepare(
      "DELETE FROM history WHERE file_id IN (SELECT id FROM files WHERE user_id = ?)"
    ).run(userId);
    db2.prepare("DELETE FROM files WHERE user_id = ?").run(userId);
    db2.prepare("DELETE FROM users WHERE id = ?").run(userId);
    return { success: true, message: "Account deleted" };
  } catch (error) {
    console.error("Failed to delete user:", error);
    return { success: false, message: "Failed to delete account" };
  }
}
function getAccountInfo(userId) {
  const db2 = getDatabase();
  const user = db2.prepare("SELECT username, created_at, last_login FROM users WHERE id = ?").get(userId);
  if (!user) return null;
  const fileCountRow = db2.prepare("SELECT COUNT(*) as count FROM files WHERE user_id = ? AND deleted_at IS NULL").get(userId);
  return {
    username: user.username,
    createdAt: user.created_at,
    lastLogin: user.last_login,
    fileCount: fileCountRow.count
  };
}
function createFile(userId, name, content = "") {
  const db2 = getDatabase();
  const id = require$$1.randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db2.prepare(
    "INSERT INTO files (id, user_id, name, content, created_at, modified_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, userId, name, content, now, now);
  return {
    id,
    userId,
    name,
    content,
    createdAt: now,
    modifiedAt: now,
    deletedAt: null
  };
}
function getFile(fileId, userId) {
  const db2 = getDatabase();
  const row = db2.prepare("SELECT * FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(fileId, userId);
  if (!row) return void 0;
  return mapRowToFile(row);
}
function updateFileContent(fileId, userId, content) {
  const db2 = getDatabase();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db2.prepare(
    "UPDATE files SET content = ?, modified_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
  ).run(content, now, fileId, userId);
  return getFile(fileId, userId);
}
function deleteFile(fileId, userId) {
  const db2 = getDatabase();
  const result = db2.prepare("UPDATE files SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").run((/* @__PURE__ */ new Date()).toISOString(), fileId, userId);
  return result.changes > 0;
}
function listFiles(userId) {
  const db2 = getDatabase();
  const rows = db2.prepare(
    "SELECT * FROM files WHERE user_id = ? AND deleted_at IS NULL ORDER BY modified_at DESC"
  ).all(userId);
  return rows.map(mapRowToFile);
}
function mapRowToFile(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    content: row.content || "",
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
    deletedAt: row.deleted_at
  };
}
function saveVersion(fileId, version, diff2 = null) {
  const db2 = getDatabase();
  const id = require$$1.randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db2.prepare(
    "INSERT INTO history (id, file_id, version, diff, saved_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, fileId, version, diff2, now);
  return { id, fileId, version, diff: diff2, savedAt: now };
}
function getHistoryForFile(fileId) {
  const db2 = getDatabase();
  const rows = db2.prepare("SELECT * FROM history WHERE file_id = ? ORDER BY saved_at DESC").all(fileId);
  return rows.map((row) => ({
    id: row.id,
    fileId: row.file_id,
    version: row.version,
    diff: row.diff,
    savedAt: row.saved_at
  }));
}
function getLastVersion(fileId) {
  const db2 = getDatabase();
  const row = db2.prepare("SELECT MAX(version) as max_version FROM history WHERE file_id = ?").get(fileId);
  return (row == null ? void 0 : row.max_version) ?? 0;
}
function getSettings(userId) {
  const db2 = getDatabase();
  const row = db2.prepare("SELECT * FROM settings WHERE user_id = ?").get(userId);
  if (!row) return void 0;
  return {
    id: row.id,
    userId: row.user_id,
    theme: row.theme || "dark",
    language: row.language || "zh-CN",
    customColors: row.custom_colors
  };
}
function updateSettings(userId, updates) {
  const db2 = getDatabase();
  const existing = getSettings(userId);
  if (existing) {
    const theme = updates.theme ?? existing.theme;
    const language = updates.language ?? existing.language;
    const customColors = updates.customColors !== void 0 ? updates.customColors : existing.customColors;
    db2.prepare(
      "UPDATE settings SET theme = ?, language = ?, custom_colors = ? WHERE user_id = ?"
    ).run(theme, language, customColors, userId);
  } else {
    const id = require$$1.randomUUID();
    const theme = updates.theme || "dark";
    const language = updates.language || "zh-CN";
    const customColors = updates.customColors || null;
    db2.prepare(
      "INSERT INTO settings (id, user_id, theme, language, custom_colors) VALUES (?, ?, ?, ?, ?)"
    ).run(id, userId, theme, language, customColors);
  }
  return getSettings(userId);
}
function getJwtSecret() {
  return require$$1.createHash("sha256").update(electron.app.getPath("userData")).digest("hex");
}
function generateToken(userId, username, rememberMe) {
  const expiresIn = rememberMe ? "30d" : "1d";
  return jwt.sign({ userId, username }, getJwtSecret(), { expiresIn });
}
function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    return decoded;
  } catch {
    return null;
  }
}
function registerAllIpcHandlers() {
  electron.ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    var _a;
    (_a = electron.BrowserWindow.fromWebContents(event.sender)) == null ? void 0 : _a.minimize();
  });
  electron.ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (win == null ? void 0 : win.isMaximized()) {
      win.unmaximize();
    } else {
      win == null ? void 0 : win.maximize();
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.WINDOW_UNMAXIMIZE, (event) => {
    var _a;
    (_a = electron.BrowserWindow.fromWebContents(event.sender)) == null ? void 0 : _a.unmaximize();
  });
  electron.ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    var _a;
    (_a = electron.BrowserWindow.fromWebContents(event.sender)) == null ? void 0 : _a.close();
  });
  electron.ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (event) => {
    var _a;
    return ((_a = electron.BrowserWindow.fromWebContents(event.sender)) == null ? void 0 : _a.isMaximized()) ?? false;
  });
  electron.ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_FILE, async (event) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false, error: "No window" };
    const result = await electron.dialog.showOpenDialog(win, {
      title: "Open Markdown File",
      filters: [{ name: "Markdown", extensions: ["md"] }],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: "Cancelled" };
    }
    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, "utf-8");
    const name = filePath.split(/[/\\]/).pop() || "untitled.md";
    return { success: true, data: { path: filePath, name, content } };
  });
  electron.ipcMain.handle(IPC_CHANNELS.DIALOG_SAVE_FILE, async (_event, { defaultName, filters }) => {
    const win = electron.BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: "No window" };
    const result = await electron.dialog.showSaveDialog(win, {
      title: "Export File",
      defaultPath: defaultName,
      filters: filters || [{ name: "All Files", extensions: ["*"] }]
    });
    if (result.canceled || !result.filePath) {
      return { success: false, error: "Cancelled" };
    }
    return { success: true, data: { filePath: result.filePath } };
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH_REGISTER, async (_event, { username, password }) => {
    if (!username || typeof username !== "string") {
      return { success: false, message: "Username is required" };
    }
    const normalized = username.toLowerCase().trim();
    if (!USERNAME_REGEX.test(normalized)) {
      return {
        success: false,
        message: "Username must be 5-15 characters, start with a letter, and contain only a-z, 0-9, _"
      };
    }
    if (RESERVED_USERNAMES.includes(normalized)) {
      return { success: false, message: "This username is reserved and cannot be used" };
    }
    if (!password || typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
      return { success: false, message: "Password must be at least 8 characters" };
    }
    const result = createUser(normalized, password);
    return result;
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_event, { username, password, rememberMe }) => {
    if (!username || !password) {
      return { success: false, message: "Username and password are required" };
    }
    const result = validateCredentials(username, password);
    if (!result.success || !result.user) {
      return { success: false, message: result.message };
    }
    const token = generateToken(result.user.id, result.user.username, rememberMe || false);
    return {
      success: true,
      data: {
        token,
        user: {
          id: result.user.id,
          username: result.user.username,
          createdAt: result.user.created_at,
          lastLogin: result.user.last_login
        }
      }
    };
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH_CHECK_USERNAME, async (_event, username) => {
    if (!username || typeof username !== "string") {
      return { available: false, message: "Username is required" };
    }
    const normalized = username.toLowerCase().trim();
    if (!USERNAME_REGEX.test(normalized)) {
      return {
        available: false,
        message: "Username must be 5-15 chars, start with letter, a-z/0-9/_"
      };
    }
    if (RESERVED_USERNAMES.includes(normalized)) {
      return { available: false, message: "This username is reserved" };
    }
    if (isUsernameTaken(normalized)) {
      return { available: false, message: "This username is already taken" };
    }
    return { available: true, message: "Username is available" };
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH_VALIDATE_TOKEN, async (_event, token) => {
    if (!token) return { success: false };
    const decoded = verifyToken(token);
    if (!decoded) return { success: false };
    const user = findById(decoded.userId);
    if (!user) return { success: false };
    return {
      success: true,
      data: {
        id: user.id,
        username: user.username,
        createdAt: user.created_at,
        lastLogin: user.last_login
      }
    };
  });
  electron.ipcMain.handle(IPC_CHANNELS.ACCOUNT_INFO, async (_event, userId) => {
    try {
      const info = getAccountInfo(userId);
      if (!info) return { success: false, message: "User not found" };
      return { success: true, data: info };
    } catch (error) {
      return { success: false, message: "Failed to get account info" };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.ACCOUNT_DELETE, async (_event, userId) => {
    try {
      const result = deleteUser(userId);
      return result;
    } catch (error) {
      return { success: false, message: "Failed to delete account" };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.ACCOUNT_EXPORT, async () => {
    return { success: false, message: "Export not yet implemented" };
  });
  electron.ipcMain.handle(IPC_CHANNELS.FILE_CREATE, async (_event, { userId, name }) => {
    try {
      const file = createFile(userId, name || "untitled.md");
      return { success: true, data: file };
    } catch (error) {
      return { success: false, message: "Failed to create file" };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.FILE_LIST, async (_event, userId) => {
    try {
      const files = listFiles(userId);
      return { success: true, data: files };
    } catch (error) {
      return { success: false, message: "Failed to list files" };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.FILE_SAVE, async (_event, { fileId, content, userId }) => {
    try {
      const currentFile = getFile(fileId, userId);
      if (currentFile) {
        const lastVersion = getLastVersion(fileId);
        saveVersion(fileId, lastVersion + 1, currentFile.content);
      }
      const updated = updateFileContent(fileId, userId, content);
      if (!updated) {
        return { success: false, message: "File not found" };
      }
      return { success: true, data: updated };
    } catch (error) {
      return { success: false, message: "Failed to save file" };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.FILE_DELETE, async (_event, { fileId, userId }) => {
    try {
      const success = deleteFile(fileId, userId);
      return { success, message: success ? "File deleted" : "File not found" };
    } catch (error) {
      return { success: false, message: "Failed to delete file" };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.FILE_GET, async (_event, { fileId, userId }) => {
    try {
      const file = getFile(fileId, userId);
      if (!file) return { success: false, message: "File not found" };
      return { success: true, data: file };
    } catch (error) {
      return { success: false, message: "Failed to get file" };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.HISTORY_LIST, async (_event, fileId) => {
    try {
      const history = getHistoryForFile(fileId);
      return { success: true, data: history };
    } catch (error) {
      return { success: false, message: "Failed to get history" };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.HISTORY_GET, async (_event, { fileId, userId }) => {
    try {
      const file = getFile(fileId, userId);
      if (!file) return { success: false, message: "File not found" };
      const history = getHistoryForFile(fileId);
      return { success: true, data: { file, history } };
    } catch (error) {
      return { success: false, message: "Failed to get history entry" };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (_event, userId) => {
    try {
      const settings = getSettings(userId);
      return { success: true, data: settings || { theme: "dark", language: "zh-CN" } };
    } catch (error) {
      return { success: false, message: "Failed to get settings" };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_event, { userId, theme, language, customColors }) => {
    try {
      const updated = updateSettings(userId, { theme, language, customColors });
      return { success: true, data: updated };
    } catch (error) {
      return { success: false, message: "Failed to update settings" };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.EXPORT_MD, async (_event, { content, filename }) => {
    const win = electron.BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: "No window" };
    const result = await electron.dialog.showSaveDialog(win, {
      title: "Export Markdown",
      defaultPath: `${filename}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });
    if (result.canceled || !result.filePath) return { success: false, error: "Cancelled" };
    fs.writeFileSync(result.filePath, content, "utf-8");
    return { success: true, data: { filePath: result.filePath } };
  });
  electron.ipcMain.handle(IPC_CHANNELS.EXPORT_DOCX, async (_event, { content, filename }) => {
    const win = electron.BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: "No window" };
    const result = await electron.dialog.showSaveDialog(win, {
      title: "Export as Word",
      defaultPath: `${filename}.doc`,
      filters: [{ name: "Word Document", extensions: ["doc"] }]
    });
    if (result.canceled || !result.filePath) return { success: false, error: "Cancelled" };
    const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><pre>${content}</pre></body></html>`;
    fs.writeFileSync(result.filePath, htmlContent, "utf-8");
    return { success: true, data: { filePath: result.filePath } };
  });
  electron.ipcMain.handle(IPC_CHANNELS.EXPORT_PDF, async (_event, { content, filename }) => {
    const win = electron.BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: "No window" };
    const result = await electron.dialog.showSaveDialog(win, {
      title: "Export as PDF",
      defaultPath: `${filename}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });
    if (result.canceled || !result.filePath) return { success: false, error: "Cancelled" };
    const pdfWin = new electron.BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: -apple-system, sans-serif; padding: 40px; color: #000; background: #fff; white-space: pre-wrap; }
    </style></head><body>${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</body></html>`;
    await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    const pdfData = await pdfWin.webContents.printToPDF({ printBackground: true });
    fs.writeFileSync(result.filePath, pdfData);
    pdfWin.close();
    return { success: true, data: { filePath: result.filePath } };
  });
}
const gotTheLock = electron.app.requestSingleInstanceLock();
if (!gotTheLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", () => {
    const win = electron.BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}
electron.app.whenReady().then(() => {
  initDatabase();
  registerAllIpcHandlers();
  createMainWindow();
});
electron.app.on("window-all-closed", () => {
  closeDatabase();
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
electron.app.on("before-quit", () => {
  closeDatabase();
});
