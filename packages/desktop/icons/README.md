# Puff Collab icons

These Electron assets use the cloud mark in `packages/app/public/puff-collab.svg`. Each channel retains PNG sizes for Linux and the development dock, an ICO for Windows, and an ICNS for macOS. The build copies the selected channel into `resources/icons`.

When changing the mark, render the retained PNG dimensions and regenerate the ICO and ICNS containers. Keep these checked-in build inputs; no mobile or Tauri icon set is required by Electron.
