'use strict';

exports._chunked = function(bucket, req, res, next) {

	var policy = req.body;
	var version = req.query.v4 ? 4 : 2;
	var stringToSign = policy.headers;
	var sign = (version === 4)
		? bucket.signV4RestRequest
		: bucket.signV2RestRequest;

	sign(stringToSign, function(err, signature) {
		if (err) return next(err);

		var jsonResponse = {signature: signature};

		res.setHeader('Content-Type', 'application/json');

		if (bucket.isValidRestRequest(stringToSign, version)) {
			res.json(jsonResponse);
		} else {
			next(new Error('Invalid chunked request'));
		}
	});
};

exports._nonChunked = function(bucket, req, res, next) {

	var policy = req.body;
	var isV4 = !!req.query.v4;
	var base64Policy = new Buffer(JSON.stringify(policy)).toString('base64');
	var sign = (isV4)
		? bucket.signV4Policy
		: bucket.signV2Policy;

	sign(policy, base64Policy, function(err, signature) {
		if (err) return next(err);

		var jsonResponse = {
			policy: base64Policy,
			signature: signature
		};

		res.setHeader('Content-Type', 'application/json');

		if (bucket.isPolicyValid()) {
			res.json(jsonResponse);
		} else {
			next(new Error('Invalid non-chunked request'));
		}
	});
};

// Controller to handle the signature requests from FineUploader.
// For multipart uploads this controller gets called for every part.
exports.controller = function(bucket) {
	return function(req, res, next) {
		//var policy = req.body;
		var isChunked = !!req.body.headers;
		var sign = (isChunked)
			? exports._chunked // multipart (chunked) request
			: exports._nonChunked; // simple (non-chunked) request
		return sign(bucket, req, res, next);
	};
};
