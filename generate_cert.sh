#!/bin/bash
mkdir -p certs

# Get local IP address (linux/mac)
IP=$(hostname -I | awk '{print $1}')
echo "Generating certificate for IP: $IP and localhost"

# Create config file for OpenSSL
cat > certs/openssl.cnf <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = req_ext
x509_extensions = v3_req

[dn]
C = US
ST = State
L = City
O = Organization
OU = OrgUnit
CN = localhost

[req_ext]
subjectAltName = @alt_names

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = $IP
EOF

# Generate certificate
openssl req -new -x509 -nodes -days 365 \
    -keyout certs/key.pem \
    -out certs/cert.pem \
    -config certs/openssl.cnf

echo "Certificate generated in certs/cert.pem and certs/key.pem"
rm certs/openssl.cnf
