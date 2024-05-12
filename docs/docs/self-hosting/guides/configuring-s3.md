---
title: Configuring S3 buckets
description:
    Configure S3 endpoints to fix upload errors or use your self hosted ente
    from outside localhost
---

# Configuring S3

There are three components involved in uploading:

1.  The client (e.g. the web app or the mobile app)
2.  Ente's server (museum)
3.  The S3-compatible object storage (e.g. minio in the default starter)

For the uploads to work, all three of them need to be able to reach each other.
This is because the client uploads directly to the object storage. The
interaction goes something like this:

1.  Client wants to upload, it asks museum where it should upload to.
2.  Museum creates pre-signed URLs for the S3 bucket that was configured.
3.  Client directly uploads to the S3 buckets these URLs.

The upshot of this is that _both_ the client and museum should be able to reach
your S3 bucket.

The URL for the S3 bucket is configured in
[scripts/compose/credentials.yaml](https://github.com/ente-io/ente/blob/main/server/scripts/compose/credentials.yaml#L10).
You can edit this file directly when testing, though it is just simpler and more
robust to create a `museum.yaml` (in the same folder as the Docker compose file)
and put your custom configuration there (in your case, you can put an entire
`s3` config object in your `museum.yaml`).

> [!TIP]
>
> For more details about these configuration objects, see the documentaion for
> the `s3` object in
> [configurations/local.yaml](https://github.com/ente-io/ente/blob/main/server/configurations/local.yaml).

By default, replication is turned off so unless you've enabled you only need to
configure the endpoint for the first bucket.

The `endpoint` for the first bucket in the starter `credentials.yaml` is
`localhost:3200`. The way this works then is that both museum (`2`) and minio
(`3`) are running within the same Docker compose cluster, so are able to reach
each other. If at this point we were to run the web app (`1`) on localhost (say
using `yarn dev:photos`), it would also run on localhost and thus would be able
to reach `3`.

If you were to try and connect from a mobile app, this would not work since
`localhost:3200` would not resolve on your mobile. So you'll need to modify this
endpoint to a value, say `yourserverip:3200`, so that the mobile app can also
reach it.

The same principle applies if you're deploying to your custom domain. To
summarize:

Set the S3 bucket `endpoint` in `credentials.yaml` to a `yourserverip:3200` or
some such IP/hostname that accessible from both where you are running the Ente
clients (e.g. the mobile app) and also from within the Docker compose cluster.