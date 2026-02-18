<div align="center">
    <img src="./public/dragonfly.svg" alt="Dragonfly Logo" width="100" height="100">
    <h3>Dragonfly is a modern, high-performance SSH client.</h3>
</div>

## ✨ Features

- **🚀 Robust SSH Client**: Secure and fast SSH connections powered by Rust's `russh`.
- **📑 Multi-Tab Interface**: Manage multiple active sessions simultaneously in a tabbed interface.
- **💾 Session Management**: Save, organize, and edit your frequently used server connections for quick access.
- **📂 Integrated File Explorer**: Browse, upload, and download files on your remote servers directly from the sidebar.
- **📜 Command History**: Automatically save and easily access your command history.
- **⚡ Quick Commands**: store and execute your most frequent commands with a single click.
- **🎨 Customizable UI**: Resizable panels for File Explorer, Saved Connections, and Command History to fit your workflow.
- **🌗 Theme Support**: Fully supported Dark and Light modes.
- **🖥️ Cross-Platform**: Optimized for Windows, macOS, and Linux.

## 🛠️ Tech Stack

- **Frontend**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/), [TailwindCSS 4](https://tailwindcss.com/)
- **Backend**: [Tauri 2](https://tauri.app/), [Rust](https://www.rust-lang.org/)
- **Terminal**: [xterm.js](https://xtermjs.org/)
- **Icons**: [Material Icons](https://fonts.google.com/icons)

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your machine:

- **Node.js**: v18 or newer recommended.
- **Rust**: The latest stable version (via [rustup](https://rustup.rs/)).
- **Tauri CLI**: (Optional) `npm install -g @tauri-apps/cli`.

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/yourusername/dragonfly.git
    cd dragonfly
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    # or
    pnpm install
    # or
    yarn install
    ```

### 💻 Development

Start the development server with hot-module replacement (HMR):

```bash
npm run tauri dev
# or
pnpm tauri dev
# or
yarn tauri dev
```

This will start the Vite dev server and launch the Tauri application window.

### 📦 Build

Build the application for production:

```bash
npm run tauri build
# or
pnpm tauri build
# or
yarn tauri build
```

The build artifacts will be located in `src-tauri/target/release/bundle`.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

[MIT](LICENSE)
