'use strict';

exports._chunked = function(uploader, req, res, next) {

	var policy = req.body;
	var version = req.query.v4 ? 4 : 2;
	var stringToSign = policy.headers;
	var sign = (version === 4)
		? uploader.signV4RestRequest
		: uploader.signV2RestRequest;

	sign(stringToSign, function(err, signature) {
		if (err) return next(err);

		var jsonResponse = {signature: signature};

		res.setHeader('Content-Type', 'application/json');

		if (uploader.isValidRestRequest(stringToSign, version)) {
			res.json(jsonResponse);
		} else {
			next(new Error('Invalid chunked request'));
		}
	});
};

exports._nonChunked = function(uploader, req, res, next) {

	var policy = req.body;
	var isV4 = !!req.query.v4;
	var base64Policy = new Buffer(JSON.stringify(policy)).toString('base64');
	var sign = (isV4)
		? uploader.signV4Policy
		: uploader.signV2Policy;

	sign(policy, base64Policy, function(err, signature) {
		if (err) return next(err);

		var jsonResponse = {
			policy: base64Policy,
			signature: signature
		};

		res.setHeader('Content-Type', 'application/json');

		if (uploader.isPolicyValid(policy)) {
			res.json(jsonResponse);
		} else {
			next(new Error('Invalid non-chunked request'));
		}
	});
};


/*
Controller to handle the signature requests from FineUploader.
For multipart uploads this controller gets called for every part.

The body of the HTTP POST will be a policy like:
{ expiration: '2018-02-16T19:51:52.607Z',
  conditions:
   [ { acl: 'private' },
     { bucket: '...' },
     { 'Content-Type': 'image/jpeg' },
     { success_action_status: '200' },
     { key: '47d74567-3d30-4c28-960b-46b0637d42ac.jpg' },
     { 'x-amz-meta-qqfilename': 'background.jpg' },
     [ 'content-length-range', '0', '20000000' ] ] }
*/
exports.signer = function(uploader) {
	return function(req, res, next) {
		//var policy = req.body;
		var isChunked = !!req.body.headers;
		var sign = (isChunked)
			? exports._chunked // multipart (chunked) request
			: exports._nonChunked; // simple (non-chunked) request
		return sign(uploader, req, res, next);
	};
};

// blank page for ie9 iframe upload support
exports.blank = function() {
	return function(req, res) {
		var blank = '<html><body></body></html>';
		res.send(blank);
	};
};
