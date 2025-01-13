# readarr-server

> [!WARNING]
> This project is a work in progress and the Servarr team provides **no support** for it
>
> Please reach out to @santarr25 via Discord if you're interested in contributing

A metadata server powered by Open Library data for use by [Readarr](https://wiki.servarr.com/readarr).

## Development

This project requires a local installation of [bun](https://bun.sh/).
It also requires a PostgreSQL database with Open Library data, which currently is done by installing [Open Library database](https://github.com/LibrariesHacked/openlibrary-search),
as well as loading a mapping using https://github.com/santarrsgrotto/mapping

> [!WARNING]
> You need ~100GB of free disk space to install the database

To start the development environment:

```sh
bun install --frozen-lockfile
bun dev
```

To start the production environment use ```bun start```

> The default server url is http://0.0.0.0:8080, which can be adjusted by setting OLP_HOSTNAME and OLP_PORT (see config.ts)

