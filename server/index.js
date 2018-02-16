'use strict';

var S3 = require('@esscorp/s3');
var isString = require('lodash.isstring');
var Assert = require('assert');
//var Prove = require('provejs-params');
var CryptoJS = require('crypto-js');
var ok = Assert.ok;

module.exports = function(cfg) {

	// validate
	ok(isFinite(cfg.expires), 'Config `expires` expected to be integer.');
	ok(isString(cfg.bucket), 'Config `bucket` expected to be string.');

	// AWS client
	var s3 = new S3(cfg.iam);
	var hostname = cfg.bucket + '.s3.amazonaws.com';

	function endpoint() {
		return 'https://' + hostname;
	}

	function getAccessKeyId(next) {
		s3.credentials(function(err, credentials) {
			if (err) return next(err);
			next(null, credentials.accessKeyId);
		});
	}

	function getSecretAccessKey(next) {
		s3.credentials(function(err, credentials) {
			if (err) return next(err);
			next(null, credentials.secretAccessKey);
		});
	}

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

	function signV2Policy(policy, base64Policy, next) {

		// console.log('signV2Policy()');

		getSecretAccessKey(function(err, secretAccessKey) {
			if (err) return next(err);

			var signature = getV2SignatureKey(secretAccessKey, base64Policy);

			next(null, signature);
		});
	}

	function signV4Policy(policy, base64Policy, next) {

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
	}

	function signV2RestRequest(headersStr, next) {

		// console.log('signV2RestRequest()');

		getSecretAccessKey(function(err, secretAccessKey) {
			if (err) return next(err);

			var signature = getV2SignatureKey(secretAccessKey, headersStr);

			next(null, signature);
		});
	}

	function signV4RestRequest(headersStr, next) {

		// console.log('signV4RestRequest()');

		var matches = /.+\n.+\n(\d+)\/(.+)\/s3\/aws4_request\n([\s\S]+)/.exec(headersStr);
		var hashedCanonicalRequest = CryptoJS.SHA256(matches[3]);
		var stringToSign = headersStr.replace(/(.+s3\/aws4_request\n)[\s\S]+/, '$1' + hashedCanonicalRequest);

		getSecretAccessKey(function(err, secretAccessKey) {
			if (err) return next(err);

			var signature = getV4SignatureKey(secretAccessKey, matches[1], matches[2], 's3', stringToSign);

			next(null, signature);
		});
	}

	// Ensures the policy document associated with a 'simple' (non-chunked) request is
	// targeting the correct bucket and the min/max-size is as expected.
	// Comment out the expectedMaxSize and expectedMinSize variables near
	// the top of this file to disable size validation on the policy document.
	function isPolicyValid(policy) {

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

		// console.log('* isValidBucket:', isValidBucket);
		// console.log('* isValidSize:', isValidSize);

		return isValidBucket && isValidSize;
	}

	// Ensures the REST request is targeting the correct bucket.
	// Omit if you don't want to support chunking.
	function isValidRestRequest(headerStr, version) {
		if (version === 4) {
			return new RegExp('host:' + cfg.hostname).exec(headerStr) != null;
		} else {
			return new RegExp('/' + cfg.bucket + '/.+$').exec(headerStr) != null;
		}
	}

	// Verify file uploaded by browser.
	// Return head incase we need to create a db record using head data.
	function verifyUpload(s3Path, next) {

		s3.head(cfg.bucket, s3Path, function(err, head1) {
			if (err) return next(err);

			var size = head1.ContentLength;
			var mime = head1.ContentType;
			var etag = head1.ETag;

			if (cfg.maxSize && size > cfg.maxSize) {
				// delete file since it too large
				s3.del(cfg.bucket, s3Path, function(err) {
					if (err) return next(err);
					next(null, false, size, mime, etag);
				});
			} else {
				next(null, true, size, mime, etag);
			}
		});
	}

	// public functions
	return {
		options: cfg,
		endpoint: endpoint,
		getAccessKeyId: getAccessKeyId,
		signV2Policy: signV2Policy,
		signV4Policy: signV4Policy,
		signV2RestRequest: signV2RestRequest,
		signV4RestRequest: signV4RestRequest,
		isPolicyValid: isPolicyValid,
		isValidRestRequest: isValidRestRequest,
		verifyUpload: verifyUpload
	};
};
