# s3-fine-uploader
AWS S3 Wrapper with support for direct upload browser to S3 via the Fine Uploader. 


## Install

```bash
npm install @esscorp/s3-fine-uploader --save
```

## Usage
```js
var S3 = require('@esscorp/s3-fine-uploader');
var region = 'us-east-1';
var apiVersion = '2006-03-01';
var bucket = 'my-upload-bucket';

var uploads = new S3({
	bucket: 'my-bucket-foobar',
	expires: 60 * 60, // 1 hour
	minSize: null,
	maxSize: null,
	iam: {
		region: region,
		apiVersion: apiVersion
	}
});
```

## AWS Credentials

