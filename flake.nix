{
  description = "Plainva — an open-source, local-first editor for plain Markdown vaults (desktop app)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      # The desktop app is released for x86_64 Linux only (the deb, rpm and
      # AppImage on a release page all come from the ubuntu-22.04 runner). Add
      # systems here once a release artifact exists for them.
      systems = [ "x86_64-linux" ];

      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          # The compiled binary from the GitHub release: nothing is built, and a
          # release moves one version and one hash. See nix/plainva-bin.nix.
          plainva-bin = pkgs.callPackage ./nix/plainva-bin.nix { };
        in
        {
          inherit plainva-bin;
          default = plainva-bin;
        }
      );

      # `nix develop` — the toolchain the "Building from source" section of the
      # README lists, plus the native libraries Tauri needs on Linux.
      devShells = forAllSystems (pkgs: {
        default = pkgs.callPackage ./nix/shell.nix { };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
