'use strict';

var isString = require('lodash.isstring');
var Assert = require('assert');
var Prove = require('provejs-params');
var AWS = require('aws-sdk');
var CryptoJS = require('crypto-js');
var ok = Assert.ok;

module.exports = function(cfg) {

	// validate
	ok(isFinite(cfg.expires), 'Config `expires` expected to be integer.');
	ok(isString(cfg.bucket), 'Config `bucket` expected to be a string.');

	// AWS client
	var s3 = new AWS.S3(cfg.iam);
	var hostname = cfg.hostname || cfg.bucket + '.s3.amazonaws.com';

	function name() {
		return cfg.bucket;
	}

	function endpoint() {
		return 'https://' + hostname;
	}

	var getAccessKeyId = function(next) {

		s3.config.getCredentials(function(err) {
			if (err) return next(err);

			next(null, s3.config.credentials.accessKeyId);
		});
	};

	function getSecretAccessKey(next) {

		s3.config.getCredentials(function(err) {
			if (err) return next(err);

			next(null, s3.config.credentials.secretAccessKey);
		});
	}

	var download = function(s3Path, next) {
		var params = {
			Bucket: cfg.bucket,
			Key: s3Path
		};
		s3.getObject(params, next);
	};

	var head = function(s3Path, next) {
		var params = {
			Bucket: cfg.bucket,
			Key: s3Path
		};

		s3.headObject(params, function(err, head) {
			//if (err) console.log (err);
			if (err && err.statusCode === 404) return next(null, false);
			if (err && err.code === 'Forbidden') return next(null, false);
			if (err) return next(err);
			next(null, head);
		});
	};

	var del = function(s3Path, next) {
		var params = {
			Bucket: cfg.bucket,
			Key: s3Path
		};

		s3.deleteObject(params, function(err) {
			//if (err) console.log (err);
			if (err && err.statusCode === 404) return next(null, false);
			if (err && err.code === 'Forbidden') return next(null, false);
			if (err) return next(err);
			next();
		});
	};

	var exists = function(s3Path, next) {
		head(s3Path, function(err, head) {
			if (err) return next(err);
			next(null, (head));
		});
	};

	var contentType = function(s3Path, next) {
		head(s3Path, function(err, head) {
			if (err) return next(err);
			next(null, head.ContentType);
		});
	};

	var contents = function(s3Path, next) {
		download(s3Path, function(err, data) {
			if (err) return next(err);

			next(null, data.Body.toString());
		});
	};

	var copy = function(dstKey, srcBucket, srcKey, next) {

		var dstBucket = cfg.bucket;
		var params = {
			Bucket: dstBucket,
			CopySource: srcBucket + '/' + srcKey,
			Key: dstKey,
			MetadataDirective: 'COPY'
		};

		Prove('***F', arguments);

		s3.copyObject(params, function(err) {
			if (err) return next(err);

			next(null, dstBucket);
		});
	};

	// ***** www.fineuploader.com
	// https://github.com/FineUploader/server-examples/blob/master/nodejs/s3/s3handler.js

	function getV2SignatureKey(key, stringToSign) {
		var words = CryptoJS.HmacSHA1(stringToSign, key);
		return CryptoJS.enc.Base64.stringify(words);
	}

	function getV4SignatureKey(key, dateStamp, regionName, serviceName, stringToSign) {

		var kDate = CryptoJS.HmacSHA256(dateStamp, 'AWS4' + key);
		var kRegion = CryptoJS.HmacSHA256(regionName, kDate);
		var kService = CryptoJS.HmacSHA256(serviceName, kRegion);
		var kSigning = CryptoJS.HmacSHA256('aws4_request', kService);

		return CryptoJS.HmacSHA256(stringToSign, kSigning).toString();
	}

	var signV2Policy = function(policy, base64Policy, next) {

		// console.log('signV2Policy()');

		getSecretAccessKey(function(err, secretAccessKey) {
			if (err) return next(err);

			var signature = getV2SignatureKey(secretAccessKey, base64Policy);

			next(null, signature);
		});
	};

	var signV4Policy = function(policy, base64Policy, next) {

		// console.log('signV4Policy()');

		var conditions = policy.conditions;
		var credentialCondition;

		for (var i = 0; i < conditions.length; i++) {
			credentialCondition = conditions[i]['x-amz-credential'];
			if (credentialCondition != null) break;
		}

		var matches = /.+\/(.+)\/(.+)\/s3\/aws4_request/.exec(credentialCondition);

		getSecretAccessKey(function(err, secretAccessKey) {
			if (err) return next(err);

			var signature = getV4SignatureKey(secretAccessKey, matches[1], matches[2], 's3', base64Policy);

			next(null, signature);
		});
	};

	var signV2RestRequest = function(headersStr, next) {

		// console.log('signV2RestRequest()');

		getSecretAccessKey(function(err, secretAccessKey) {
			if (err) return next(err);

			var signature = getV2SignatureKey(secretAccessKey, headersStr);

			next(null, signature);
		});
	};

	var signV4RestRequest = function(headersStr, next) {

		// console.log('signV4RestRequest()');

		var matches = /.+\n.+\n(\d+)\/(.+)\/s3\/aws4_request\n([\s\S]+)/.exec(headersStr);
		var hashedCanonicalRequest = CryptoJS.SHA256(matches[3]);
		var stringToSign = headersStr.replace(/(.+s3\/aws4_request\n)[\s\S]+/, '$1' + hashedCanonicalRequest);

		getSecretAccessKey(function(err, secretAccessKey) {
			if (err) return next(err);

			var signature = getV4SignatureKey(secretAccessKey, matches[1], matches[2], 's3', stringToSign);

			next(null, signature);
		});
	};

	// Ensures the policy document associated with a 'simple' (non-chunked) request is
	// targeting the correct bucket and the min/max-size is as expected.
	// Comment out the expectedMaxSize and expectedMinSize variables near
	// the top of this file to disable size validation on the policy document.
	var isPolicyValid = function(policy) {

		// console.log('isPolicyValid()');

		var bucket, parsedMaxSize, parsedMinSize;
		var expectedMinSize = cfg.minSize;
		var expectedMaxSize = cfg.maxSize;
		var expectedBucket = cfg.bucket;
		var isValidBucket;
		var isValidSize = true;

		policy.conditions.forEach(function(condition) {
			if (condition.bucket) {
				bucket = condition.bucket;
			} else if (condition instanceof Array && condition[0] === 'content-length-range') {
				parsedMinSize = condition[1];
				parsedMaxSize = condition[2];
			}
		});

		// console.log('bucket'.green, bucket);
		// console.log('bucket expected'.green, expectedBucket);

		isValidBucket = (bucket === expectedBucket);

		// If expectedMinSize and expectedMax size are not null (see above), then
		// ensure that the client and server have agreed upon the exact same values.
		if (expectedMinSize != null && expectedMaxSize != null) {
			isValidSize =
				(parsedMinSize === expectedMinSize.toString())
				&& (parsedMaxSize === expectedMaxSize.toString());
		}

		// console.log('isPolicyValid()');
		// console.log('* isValidBucket:', isValidBucket);
		// console.log('* isValidSize:', isValidSize);

		return isValidBucket && isValidSize;
	};

	// Ensures the REST request is targeting the correct bucket.
	// Omit if you don't want to support chunking.
	var isValidRestRequest = function(headerStr, version) {
		if (version === 4) {
			return new RegExp('host:' + cfg.hostname).exec(headerStr) != null;
		}

		return new RegExp('/' + cfg.bucket + '/.+$').exec(headerStr) != null;
	};

	// Verify file uploaded by browser.
	// Return head incase we need to create a db record using head data.
	var verifyUpload = function(s3Path, next) {

		head(s3Path, function(err, head1) {
			if (err) return next(err);

			var size = head1.ContentLength;
			var mime = head1.ContentType;
			var etag = head1.ETag;

			if (cfg.maxSize && size > cfg.maxSize) {
				// delete file since it too large
				del(s3Path, function(err) {
					if (err) return next(err);
					next(null, false, size, mime, etag);
				});
			} else {
				next(null, true, size, mime, etag);
			}
		});
	};

	var urlPrivate = function(s3Path, next) {

		// todo:
		// https://blogs.msdn.microsoft.com/ie/2008/07/02/ie8-security-part-v-comprehensive-protection/
		// https://github.com/blog/1482-heads-up-nosniff-header-support-coming-to-chrome-and-firefox
		// X-Content-Type-Options: nosniff

		var params = {
			Bucket: cfg.bucket,
			Expires: cfg.expires,
			//ResponseContentDisposition: 'attachment',
			Key: s3Path
		};
		s3.getSignedUrl('getObject', params, next);
		//return url;
	};

	var urlDownload = function(s3Path, filename, next) {

		//Content-Disposition: attachment; filename=foo.bar
		var rcd = 'attachment; filename=' + filename;

		var params = {
			Bucket: cfg.bucket,
			Expires: cfg.expires,
			ResponseContentDisposition: rcd,
			Key: s3Path
		};
		s3.getSignedUrl('getObject', params, next);
	};

	var urlSigned = function(s3Path, mime, next) {

		Prove('SSF', arguments);

		//console.log('urlSigned()'.red, s3Path, mime);

		var params = {
			Bucket: cfg.bucket,
			Expires: cfg.expires,
			ContentType: mime,
			Key: s3Path
		};

		// force upload to fail
		// delete params.ContentType;

		s3.getSignedUrl('putObject', params, next);
	};

	// public functions
	return {

		name: name,
		endpoint: endpoint,

		getAccessKeyId: getAccessKeyId,
		// getSecretAccessKey: getSecretAccessKey,

		urlSigned: urlSigned,
		urlPrivate: urlPrivate,
		urlDownload: urlDownload,

		download: download,
		head: head,
		del: del,
		exists: exists,
		contentType: contentType,
		contents: contents,
		copy: copy,
		options: cfg,

		// www.fineuploader.com
		// getV2SignatureKey: getV2SignatureKey,
		// getV4SignatureKey: getV4SignatureKey,
		signV2Policy: signV2Policy,
		signV4Policy: signV4Policy,
		signV2RestRequest: signV2RestRequest,
		signV4RestRequest: signV4RestRequest,
		isPolicyValid: isPolicyValid,
		isValidRestRequest: isValidRestRequest,
		verifyUpload: verifyUpload
	};
};
