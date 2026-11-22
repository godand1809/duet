declare module "qrcode" {
  interface ToDataUrlOptions {
    margin?: number;
    width?: number;
    color?: { dark?: string; light?: string };
  }
  const QRCode: {
    toDataURL(text: string, opts?: ToDataUrlOptions): Promise<string>;
  };
  export default QRCode;
}
