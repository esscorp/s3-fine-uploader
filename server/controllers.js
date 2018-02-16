'use strict';

exports._chunked = function(conn, req, res, next) {

	var policy = req.body;
	var version = req.query.v4 ? 4 : 2;
	var stringToSign = policy.headers;
	var sign = (version === 4)
		? conn.signV4RestRequest
		: conn.signV2RestRequest;

	sign(stringToSign, function(err, signature) {
		if (err) return next(err);

		var jsonResponse = {signature: signature};

		res.setHeader('Content-Type', 'application/json');

		if (conn.isValidRestRequest(stringToSign, version)) {
			res.json(jsonResponse);
		} else {
			next(new Error('Invalid chunked request'));
		}
	});
};

exports._nonChunked = function(conn, req, res, next) {

	var policy = req.body;
	var isV4 = !!req.query.v4;
	var base64Policy = new Buffer(JSON.stringify(policy)).toString('base64');
	var sign = (isV4)
		? conn.signV4Policy
		: conn.signV2Policy;

	sign(policy, base64Policy, function(err, signature) {
		if (err) return next(err);

		var jsonResponse = {
			policy: base64Policy,
			signature: signature
		};

		res.setHeader('Content-Type', 'application/json');

		if (conn.isPolicyValid()) {
			res.json(jsonResponse);
		} else {
			next(new Error('Invalid non-chunked request'));
		}
	});
};

// Controller to handle the signature requests from FineUploader.
// For multipart uploads this controller gets called for every part.
exports.signer = function(conn) {
	return function(req, res, next) {
		//var policy = req.body;
		var isChunked = !!req.body.headers;
		var sign = (isChunked)
			? exports._chunked // multipart (chunked) request
			: exports._nonChunked; // simple (non-chunked) request
		return sign(conn, req, res, next);
	};
};

// blank page for ie9 iframe upload support
exports.blank = function() {
	return function(req, res) {
		var blank = '<html><body></body></html>';
		res.send(blank);
	};
};
