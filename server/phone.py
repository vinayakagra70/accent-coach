"""Phone mode: serve Accent Coach to phones on the same Wi-Fi.

    .venv\\Scripts\\python.exe -m server.phone        (start-phone.bat does this)

Phone browsers only allow the microphone on HTTPS, so this makes a self-signed
certificate for the laptop's Wi-Fi address (the phone will warn once; that's
expected for a certificate you made yourself). A random access key, shown in
the link and QR code, keeps other devices on the network out.
"""
from __future__ import annotations

import datetime as dt
import ipaddress
import secrets
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CERT_DIR = ROOT / "certs"
KEY_FILE = ROOT / "data" / "phone_key.txt"
PORT = 5443


def lan_ip() -> str:
    """The address other devices on the Wi-Fi reach this laptop at.
    (Connecting a UDP socket picks the outgoing interface; no packet is sent.)"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.168.0.1", 9))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def access_key() -> str:
    KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    if KEY_FILE.exists():
        k = KEY_FILE.read_text(encoding="utf-8").strip()
        if len(k) >= 16:
            return k
    k = secrets.token_urlsafe(18)
    KEY_FILE.write_text(k, encoding="utf-8")
    return k


def ensure_cert(ip: str) -> tuple[Path, Path]:
    """Self-signed cert valid for this IP, localhost and the PC name. Remade if the IP changed."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    CERT_DIR.mkdir(exist_ok=True)
    cert_path, key_path = CERT_DIR / "cert.pem", CERT_DIR / "key.pem"
    if cert_path.exists() and key_path.exists():
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        try:
            ips = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.IPAddress)
        except x509.ExtensionNotFound:
            ips = []
        if ipaddress.ip_address(ip) in ips and cert.not_valid_after_utc > dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=7):
            return cert_path, key_path

    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Accent Coach (this laptop)")])
    now = dt.datetime.now(dt.timezone.utc)
    sans = [x509.IPAddress(ipaddress.ip_address(ip)), x509.IPAddress(ipaddress.ip_address("127.0.0.1")), x509.DNSName("localhost")]
    host = socket.gethostname()
    if host:
        sans.append(x509.DNSName(host))
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName(sans), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert_path, key_path


def main() -> None:
    import uvicorn

    from .app import create_app

    ip = lan_ip()
    key = access_key()
    cert, pkey = ensure_cert(ip)
    url = f"https://{ip}:{PORT}/?key={key}"
    try:
        app = create_app(access_key=key, serve_app=True)
    except RuntimeError as exc:
        print(exc)
        sys.exit(1)

    print("\n  Accent Coach on your phone")
    print("  --------------------------")
    print("  1. Connect the phone to the same Wi-Fi as this laptop.")
    print("  2. Scan this QR code, or type the link:\n")
    try:
        import qrcode

        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.print_ascii(invert=True)
    except Exception:
        pass
    print(f"\n  {url}\n")
    print("  3. The phone warns that the connection isn't private. That's this laptop's own")
    print("     certificate: tap Advanced, then Proceed (Chrome) / Show Details, visit (Safari).")
    print("  4. If Windows asks whether Python may use the network, allow Private networks.\n")
    if ip == "127.0.0.1":
        print("  ! No Wi-Fi address found: is this laptop connected to Wi-Fi?\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT, ssl_certfile=str(cert), ssl_keyfile=str(pkey), log_level="warning")


if __name__ == "__main__":
    main()
