{
  description = "Plainva — an open-source, local-first editor for plain Markdown vaults (desktop app)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      # The desktop app is built and released for x86_64 Linux only (the deb,
      # rpm and AppImage on a release page all come from the ubuntu-22.04
      # runner). Add systems here once a release or a build exists for them —
      # `plainva-bin` additionally needs a matching release artifact.
      systems = [ "x86_64-linux" ];

      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          plainva = pkgs.callPackage ./nix/plainva.nix { src = self; };
        in
        {
          inherit plainva;

          # The compiled binary from the GitHub release, for a fast install
          # without a Rust and frontend build. See nix/plainva-bin.nix.
          plainva-bin = pkgs.callPackage ./nix/plainva-bin.nix { };

          default = plainva;
        }
      );

      # `nix develop` — the toolchain the "Building from source" section of the
      # README lists, plus the native libraries Tauri needs on Linux.
      devShells = forAllSystems (pkgs: {
        default = pkgs.callPackage ./nix/shell.nix { };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);

      # `nix flake check` builds the source package; the binary package is left
      # out on purpose, so a check does not download a release artifact.
      checks = forAllSystems (pkgs: {
        inherit (self.packages.${pkgs.stdenv.hostPlatform.system}) plainva;
      });
    };
}
