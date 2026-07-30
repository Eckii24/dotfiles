# pi-agent-base:0.12.0

Extension builds and imports this image automatically on first `pi --sandbox` startup. Build only on a trusted host: it downloads Alpine packages and the SHA-256-verified RTK release.

This creates a Gondolin image-store entry; `docker build` does not. Image uses verified RTK 0.43.0 x86_64 musl on x86_64. On Apple Silicon, extension builds RTK 0.43.0 from its versioned source tag inside native Alpine because that release has no aarch64 musl asset. Do not copy or commit image binaries. Extension fails closed if image build, Gondolin, or RTK startup fails.
