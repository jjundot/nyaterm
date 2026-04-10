//! Backend services and shared domain logic.
//!
//! Groups runtime session management, SSH services, translations, importers,
//! and common error types under one backend-oriented namespace.

pub mod history;
pub mod importer;
mod pty;
mod recording;
mod session;
pub mod ssh;
pub mod stats;
pub mod translate;
pub(crate) mod watcher;

pub use pty::create_local_session;
pub use recording::RecordingManager;
pub use session::{
    SessionCommand, SessionHandle, SessionInfo, SessionManager, SessionType, SharedCwd,
};
