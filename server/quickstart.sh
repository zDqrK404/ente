#!/bin/sh
#
# Ente self-host quickstart helper script.
#
# Usage:
# sh -c "$(curl -fsSL https://raw.githubusercontent.com/ente-io/ente/main/server/quickstart.sh)"
#
# Docs:
# https://github.com/ente-io/ente/blob/main/server/quickstart/README.md

set -e

dcv=`docker compose version --short 2>/dev/null`

if test -z "$dcv"
then
    printf "ERROR: Please install Docker Compose before running this script.\n"
    exit 1
fi

dcv_maj=`echo "$dcv" | cut -d . -f 1`
dcv_min=`echo "$dcv" | cut -d . -f 2`

if test \( "$dcv_maj" -lt 2 \) -o \( "$dcv_maj" -eq 2 -a "$dcv_min" -lt 30 \)
then
    printf "ERROR: Docker Compose version ($dcv) should be at least 2.30+ for running this script.\n"
    exit 1
fi

if ! command -v base64 >/dev/null
then
    printf "ERROR: base64 command not found. It is needed to autogenerate credentials.\n"
    exit 1
fi

if test -d my-ente
then
    printf "ERROR: A directory named 'my-ente' already exists.\n"
    printf "       Aborting script to avoid accidentally overwriting user data.\n"
    exit 1
fi

printf "\n - \033[1mH E L L O\033[0m - \033[1;32mE N T E\033[0m -\n\n"

mkdir my-ente && cd my-ente
printf " \033[1;32mE\033[0m   Created directory my-ente\n"

curl -fsSOL https://raw.githubusercontent.com/ente-io/ente/main/server/quickstart/compose.yaml
printf " \033[1;32mN\033[0m   Fetched compose.yaml\n"

gen_password () { head -c 12 /dev/urandom | base64 -w 0 }

# crypto_secretbox_KEYBYTES = 32
gen_key () { head -c 32 /dev/urandom | base64 -w 0 }

# crypto_generichash_BYTES_MAX = 64
gen_hash () { head -c 64 /dev/urandom | base64 -w 0 }

# Like gen_key but sodium_base64_VARIANT_URLSAFE which converts + to -, / to _
gen_jwt_secret () { head -c 32 /dev/urandom | base64 -w 0 | tr '+/' '-_' }

replace_in_compose () {
   sed "$1" compose.yaml > compose.yaml.new
   mv compose.yaml.new compose.yaml
}

replace_in_compose "s,changeme1234,$(gen_password),g"
replace_in_compose "s,changeme,minio-user,g"
replace_in_compose "s,pgpass,$(gen_password),g"
replace_in_compose "s,yvmG/RnzKrbCb9L3mgsmoxXr9H7i2Z4qlbT0mL3ln4w=,$(gen_key),"
replace_in_compose "s,KXYiG07wC7GIgvCSdg+WmyWdXDAn6XKYJtp/wkEU7x573+byBRAYtpTP0wwvi8i/4l37uicX1dVTUzwH3sLZyw==,$(gen_hash),"
replace_in_compose "s,i2DecQmfGreG6q1vBj5tCokhlN41gcfS2cjOs9Po-u8=,$(gen_jwt_secret),"

touch museum.yaml
printf " \033[1;32mT\033[0m   Created museum.yaml\n"

printf " \033[1;32mE\033[0m   Starting docker compose\n"
printf "\nAfter the cluster has started, open web app at \033[1mhttp://localhost:3000\033[0m\n"
printf "For more details, see https://github.com/ente-io/ente/blob/main/server/quickstart/README.md\n\n"

sleep 1

docker compose up
