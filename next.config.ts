import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cross-origin isolation lets Laya's CPU (WASM) backend use several threads. `credentialless` keeps cross-origin
  // loads that don't send cookies (the model files on Hugging Face, the ONNX Runtime files on jsDelivr) working.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
