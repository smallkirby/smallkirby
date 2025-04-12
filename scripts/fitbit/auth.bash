#!/bin/bash

set -eu

export C_RST="\e[0m"
export C_GREEN="\e[32m"
export C_LGREEN="\e[92m"
export C_RED="\e[31m"
export C_PURPLE="\e[35m"
export C_BOLD="\e[1m"
export C_UL="\e[4m"

echo -en "${C_GREEN}[+]${C_RST} Checking env...: "
for e in \
  "CLIENT_ID" \
  "CLIENT_SECRET" \
; do
  if [ -z "$(eval echo \$"$e")" ]; then
    echo -e "\n${C_RED}[!]${C_RST} Env $e not found"
    exit 1
  fi
done
echo -e "${C_GREEN}OK${C_RST}"

VERIFIER=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 100 | head -n 1)
CHALLENGE=$(echo -n $VERIFIER | openssl dgst -sha256 -binary | openssl base64 | tr -d '=' | tr '/+' '_-')

xdg-open \
"https://www.fitbit.com/oauth2/authorize?client_id=$CLIENT_ID&response_type=code&code_challenge=$CHALLENGE&code_challenge_method=S256&scope=sleep+activity" \
> /dev/null 2>&1

echo -en "${C_GREEN}[+]${C_RST} Waiting for code > "
read CODE <&0

curl https://api.fitbit.com/oauth2/token \
  -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n "$CLIENT_ID:$CLIENT_SECRET" | base64)" \
  -d "client_id=$CLIENT_ID" \
  -d "grant_type=authorization_code" \
  -d "code=$CODE" \
  -d "code_verifier=$VERIFIER"
