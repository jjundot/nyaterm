import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../../context/AppContext";
import { themeList } from "../../themes";
import { AVAILABLE_LANGUAGES } from "../../i18n";

export default function SettingsDialog() {
    const { t, i18n } = useTranslation();
    const { showSettingsDialog, setShowSettingsDialog, appSettings, updateAppSettings, uiConfig, updateUiConfig } = useApp();
    const [activeTab, setActiveTab] = useState("general");
    const [systemFonts, setSystemFonts] = useState<string[]>([]);

    useEffect(() => {
        invoke<string[]>("get_system_fonts")
            .then(fonts => setSystemFonts(fonts))
            .catch(console.error);
    }, []);

    // Close dialog on ESC
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && showSettingsDialog) {
                setShowSettingsDialog(false);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [showSettingsDialog, setShowSettingsDialog]);

    if (!showSettingsDialog) return null;

    const tabs = [
        { id: "general", label: t("settings.general", "General"), icon: "settings" },
        { id: "appearance", label: t("settings.appearance", "Appearance"), icon: "palette" },
        { id: "proxy", label: t("settings.proxy", "Proxy"), icon: "router" },
        { id: "search", label: t("settings.search", "Search"), icon: "search" },
        { id: "translation", label: t("settings.translation", "Translation"), icon: "translate" },
        { id: "security", label: t("settings.security", "Security"), icon: "security" },
        { id: "terminal", label: t("settings.terminal", "Terminal Core"), icon: "terminal" },
        { id: "interaction", label: t("settings.interaction", "Interaction"), icon: "mouse" },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 text-sm" style={{ fontFamily: appSettings.appearance.font_family }}>
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
                onClick={() => setShowSettingsDialog(false)}
            />

            {/* Dialog */}
            <div
                className="relative w-full max-w-4xl h-[80vh] flex flex-col sm:flex-row rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                style={{
                    backgroundColor: "var(--df-bg-panel)",
                    color: "var(--df-text)",
                    border: "1px solid var(--df-border)",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Sidebar */}
                <div
                    className="w-full sm:w-64 flex-shrink-0 flex flex-col border-r overflow-y-auto"
                    style={{ borderColor: "var(--df-border)", backgroundColor: "var(--df-bg)" }}
                >
                    <div className="p-6 border-b shrink-0 flex items-center gap-3" style={{ borderColor: "var(--df-border)" }}>
                        <span className="material-icons text-2xl" style={{ color: "var(--df-primary)" }}>settings</span>
                        <h2 className="text-xl font-semibold">{t("settings.title", "Settings")}</h2>
                    </div>

                    <div className="flex-1 py-3 px-3 space-y-1">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors"
                                style={{
                                    backgroundColor: activeTab === tab.id ? "color-mix(in srgb, var(--df-primary) 15%, transparent)" : "transparent",
                                    color: activeTab === tab.id ? "var(--df-primary)" : "var(--df-text)",
                                }}
                            >
                                <span className="material-icons text-[18px]" style={{ color: activeTab === tab.id ? "var(--df-primary)" : "var(--df-text-muted)" }}>{tab.icon}</span>
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 flex flex-col min-w-0" style={{ backgroundColor: "var(--df-bg-panel)" }}>
                    <div className="p-6 border-b shrink-0 flex items-center justify-between" style={{ borderColor: "var(--df-border)" }}>
                        <h3 className="text-2xl font-semibold">
                            {tabs.find(t => t.id === activeTab)?.label}
                        </h3>
                        <button
                            onClick={() => setShowSettingsDialog(false)}
                            className="p-1 rounded-md transition-colors hover:bg-black/10 dark:hover:bg-white/10"
                            style={{ color: "var(--df-text-muted)" }}
                        >
                            <span className="material-icons text-xl">close</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 md:p-8">
                        <div className="max-w-2xl text-base space-y-6">
                            {activeTab === "general" && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.startupRestore", "Restore previous session on startup")}</label>
                                            <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.startupRestoreDesc", "Automatically reconnect to tabs that were open when you last closed the app.")}</p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded appearance-none checked:bg-[var(--df-primary)] border checked:border-transparent transition-colors relative after:content-[''] after:absolute after:top-[2px] after:left-[5px] after:w-1.5 after:h-2.5 after:border-r-2 after:border-b-2 after:border-white after:rotate-45 after:hidden checked:after:block"
                                            style={{ borderColor: "var(--df-border)" }}
                                            checked={appSettings.general.startup_restore}
                                            onChange={(e) => updateAppSettings({ general: { ...appSettings.general, startup_restore: e.target.checked } })}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.defaultLocalShell", "Default Local Shell")}</label>
                                        <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.defaultLocalShellDesc", "The shell path to use when opening a local terminal.")}</p>
                                        <input
                                            type="text"
                                            className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow"
                                            style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                            value={appSettings.general.default_local_shell}
                                            onChange={(e) => updateAppSettings({ general: { ...appSettings.general, default_local_shell: e.target.value } })}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.minimizeToTray", "Minimize to tray on close")}</label>
                                            <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.minimizeToTrayDesc", "Keep the application running in the background when the window is closed.")}</p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded appearance-none checked:bg-[var(--df-primary)] border checked:border-transparent transition-colors relative after:content-[''] after:absolute after:top-[2px] after:left-[5px] after:w-1.5 after:h-2.5 after:border-r-2 after:border-b-2 after:border-white after:rotate-45 after:hidden checked:after:block"
                                            style={{ borderColor: "var(--df-border)" }}
                                            checked={appSettings.general.minimize_to_tray}
                                            onChange={(e) => updateAppSettings({ general: { ...appSettings.general, minimize_to_tray: e.target.checked } })}
                                        />
                                    </div>
                                </div>
                            )}

                            {activeTab === "appearance" && (
                                <div className="space-y-5">
                                    <div className="space-y-1">
                                        <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.theme", "Theme")}</label>
                                        <p className="text-xs pb-1" style={{ color: "var(--df-text-muted)" }}>{t("settings.themeDesc", "Select the color theme for the terminal and application.")}</p>
                                        <select
                                            className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow appearance-none"
                                            style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                            value={appSettings.appearance.theme || "github-dark"}
                                            onChange={(e) => updateAppSettings({ appearance: { ...appSettings.appearance, theme: e.target.value } })}
                                        >
                                            {themeList.map((tm) => (
                                                <option key={tm.id} value={tm.id}>{tm.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.language", "Language")}</label>
                                        <p className="text-xs pb-1" style={{ color: "var(--df-text-muted)" }}>{t("settings.languageDesc", "Select the display language for the application interface.")}</p>
                                        <select
                                            className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow appearance-none"
                                            style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                            value={uiConfig.language || "en"}
                                            onChange={(e) => {
                                                const lng = e.target.value;
                                                i18n.changeLanguage(lng);
                                                updateUiConfig({ language: lng });
                                            }}
                                        >
                                            {AVAILABLE_LANGUAGES.map(lng => (
                                                <option key={lng.id} value={lng.id}>{lng.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.fontFamily", "Font Family")}</label>
                                        <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.fontFamilyDesc", "The font family used in the terminal and app UI. Topmost font has highest priority.")}</p>

                                        <div className="space-y-2">
                                            {appSettings.appearance.font_family.split(",").map(f => f.trim()).map((font, idx, arr) => (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <span className="text-xs w-20 flex-shrink-0" style={{ color: "var(--df-text-muted)" }}>{idx === 0 ? t("settings.fontPrimary", "Primary") : t("settings.fontFallback", "Fallback") + " " + idx}</span>
                                                    <select
                                                        className="flex-1 px-3 py-1.5 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow appearance-none"
                                                        style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                                        value={systemFonts.includes(font) ? font : ""}
                                                        onChange={(e) => {
                                                            const newFonts = [...arr];
                                                            newFonts[idx] = e.target.value;
                                                            updateAppSettings({ appearance: { ...appSettings.appearance, font_family: newFonts.filter(Boolean).join(", ") } });
                                                        }}
                                                    >
                                                        {/* Ensure a blank/fallback option exists if the font is missing from the system list initially */
                                                            !systemFonts.includes(font) && <option value={font}>{font} (Custom/Missing)</option>}
                                                        {systemFonts.map(f => <option key={f} value={f}>{f}</option>)}
                                                    </select>
                                                    <button
                                                        onClick={() => {
                                                            const newFonts = arr.filter((_, i) => i !== idx);
                                                            if (newFonts.length === 0) newFonts.push("Consolas"); // Ensure at least one
                                                            updateAppSettings({ appearance: { ...appSettings.appearance, font_family: newFonts.join(", ") } });
                                                        }}
                                                        className="p-1.5 rounded text-red-500 hover:bg-red-500/10 transition-colors"
                                                        title={t("common.remove", "Remove")}
                                                    >
                                                        <span className="material-icons text-[16px]">close</span>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            onClick={() => {
                                                const newFonts = [...appSettings.appearance.font_family.split(",").map(f => f.trim()), systemFonts[0] || "Arial"];
                                                updateAppSettings({ appearance: { ...appSettings.appearance, font_family: newFonts.join(", ") } });
                                            }}
                                            className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors mt-1"
                                            style={{ backgroundColor: "color-mix(in srgb, var(--df-primary) 10%, transparent)", color: "var(--df-primary)" }}
                                        >
                                            <span className="material-icons text-[14px]">add</span> {t("settings.addFallbackFont", "Add Fallback")}
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.fontSize", "Font Size (px)")}</label>
                                            <input
                                                type="number"
                                                min={8} max={72}
                                                className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow"
                                                style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                                value={appSettings.appearance.font_size}
                                                onChange={(e) => updateAppSettings({ appearance: { ...appSettings.appearance, font_size: parseInt(e.target.value) || 14 } })}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.cursorStyle", "Cursor Style")}</label>
                                            <select
                                                className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow appearance-none"
                                                style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                                value={appSettings.appearance.cursor_style}
                                                onChange={(e) => updateAppSettings({ appearance: { ...appSettings.appearance, cursor_style: e.target.value } })}
                                            >
                                                <option value="block">{t("settings.cursorBlock", "Block")}</option>
                                                <option value="underline">{t("settings.cursorUnderline", "Underline")}</option>
                                                <option value="bar">{t("settings.cursorBar", "Bar")}</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.cursorBlink", "Cursor Blink")}</label>
                                        </div>
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded appearance-none checked:bg-[var(--df-primary)] border checked:border-transparent transition-colors relative after:content-[''] after:absolute after:top-[2px] after:left-[5px] after:w-1.5 after:h-2.5 after:border-r-2 after:border-b-2 after:border-white after:rotate-45 after:hidden checked:after:block"
                                            style={{ borderColor: "var(--df-border)" }}
                                            checked={appSettings.appearance.cursor_blink}
                                            onChange={(e) => updateAppSettings({ appearance: { ...appSettings.appearance, cursor_blink: e.target.checked } })}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.fontLigatures", "Enable Font Ligatures")}</label>
                                            <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.fontLigaturesDesc", "Combine multiple characters into a single typographical glyph.")}</p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded appearance-none checked:bg-[var(--df-primary)] border checked:border-transparent transition-colors relative after:content-[''] after:absolute after:top-[2px] after:left-[5px] after:w-1.5 after:h-2.5 after:border-r-2 after:border-b-2 after:border-white after:rotate-45 after:hidden checked:after:block"
                                            style={{ borderColor: "var(--df-border)" }}
                                            checked={appSettings.appearance.ligatures}
                                            onChange={(e) => updateAppSettings({ appearance: { ...appSettings.appearance, ligatures: e.target.checked } })}
                                        />
                                    </div>

                                </div>
                            )}

                            {activeTab === "terminal" && (
                                <div className="space-y-4">
                                    <div className="space-y-1">
                                        <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.scrollbackLines", "Scrollback Buffer (lines)")}</label>
                                        <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.scrollbackLinesDesc", "Number of lines kept in memory for scrolling up.")}</p>
                                        <input
                                            type="number"
                                            min={100} max={100000} step={100}
                                            className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow"
                                            style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                            value={appSettings.terminal.scrollback_lines}
                                            onChange={(e) => updateAppSettings({ terminal: { ...appSettings.terminal, scrollback_lines: parseInt(e.target.value) || 5000 } })}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.keepAliveInterval", "Keep-Alive Interval (seconds)")}</label>
                                        <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.keepAliveIntervalDesc", "Send SSH keep-alive packets every X seconds. 0 to disable.")}</p>
                                        <input
                                            type="number"
                                            min={0} max={600} step={5}
                                            className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow"
                                            style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                            value={appSettings.terminal.keep_alive_interval}
                                            onChange={(e) => updateAppSettings({ terminal: { ...appSettings.terminal, keep_alive_interval: parseInt(e.target.value) || 0 } })}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.hardwareAcceleration", "Hardware Acceleration")}</label>
                                            <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.hardwareAccelerationDesc", "Use GPU for terminal rendering (WebGL/Canvas). Requires restart.")}</p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded appearance-none checked:bg-[var(--df-primary)] border checked:border-transparent transition-colors relative after:content-[''] after:absolute after:top-[2px] after:left-[5px] after:w-1.5 after:h-2.5 after:border-r-2 after:border-b-2 after:border-white after:rotate-45 after:hidden checked:after:block"
                                            style={{ borderColor: "var(--df-border)" }}
                                            checked={appSettings.terminal.hardware_acceleration}
                                            onChange={(e) => updateAppSettings({ terminal: { ...appSettings.terminal, hardware_acceleration: e.target.checked } })}
                                        />
                                    </div>
                                </div>
                            )}

                            {activeTab === "interaction" && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.copyOnSelect", "Copy on Select")}</label>
                                            <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.copyOnSelectDesc", "Automatically copy selected text to the clipboard.")}</p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded appearance-none checked:bg-[var(--df-primary)] border checked:border-transparent transition-colors relative after:content-[''] after:absolute after:top-[2px] after:left-[5px] after:w-1.5 after:h-2.5 after:border-r-2 after:border-b-2 after:border-white after:rotate-45 after:hidden checked:after:block"
                                            style={{ borderColor: "var(--df-border)" }}
                                            checked={appSettings.interaction.copy_on_select}
                                            onChange={(e) => updateAppSettings({ interaction: { ...appSettings.interaction, copy_on_select: e.target.checked } })}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.rightClickPaste", "Right-click Paste")}</label>
                                            <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.rightClickPasteDesc", "Paste clipboard content on right-click instead of opening context menu.")}</p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded appearance-none checked:bg-[var(--df-primary)] border checked:border-transparent transition-colors relative after:content-[''] after:absolute after:top-[2px] after:left-[5px] after:w-1.5 after:h-2.5 after:border-r-2 after:border-b-2 after:border-white after:rotate-45 after:hidden checked:after:block"
                                            style={{ borderColor: "var(--df-border)" }}
                                            checked={appSettings.interaction.right_click_paste}
                                            onChange={(e) => updateAppSettings({ interaction: { ...appSettings.interaction, right_click_paste: e.target.checked } })}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.wordSeparators", "Word Separators")}</label>
                                        <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.wordSeparatorsDesc", "Characters that separate words for double-click selection.")}</p>
                                        <input
                                            type="text"
                                            className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow"
                                            style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                            value={appSettings.interaction.word_separators}
                                            onChange={(e) => updateAppSettings({ interaction: { ...appSettings.interaction, word_separators: e.target.value } })}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.defaultEncoding", "Default Encoding")}</label>
                                        <select
                                            className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow appearance-none"
                                            style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                            value={appSettings.interaction.default_encoding}
                                            onChange={(e) => updateAppSettings({ interaction: { ...appSettings.interaction, default_encoding: e.target.value } })}
                                        >
                                            <option value="UTF-8">UTF-8</option>
                                            <option value="GBK">GBK</option>
                                        </select>
                                    </div>
                                </div>
                            )}

                            {activeTab === "proxy" && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.enableProxy", "Enable Proxy")}</label>
                                            <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.enableProxyDesc", "Route SSH connections through a proxy server.")}</p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded appearance-none checked:bg-[var(--df-primary)] border checked:border-transparent transition-colors relative after:content-[''] after:absolute after:top-[2px] after:left-[5px] after:w-1.5 after:h-2.5 after:border-r-2 after:border-b-2 after:border-white after:rotate-45 after:hidden checked:after:block"
                                            style={{ borderColor: "var(--df-border)" }}
                                            checked={appSettings.proxy.enabled}
                                            onChange={(e) => updateAppSettings({ proxy: { ...appSettings.proxy, enabled: e.target.checked } })}
                                        />
                                    </div>

                                    <div className={`space-y-4 ${!appSettings.proxy.enabled ? "opacity-50 pointer-events-none" : ""}`}>
                                        <div className="space-y-1">
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.proxyProtocol", "Protocol")}</label>
                                            <select
                                                className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow appearance-none"
                                                style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                                value={appSettings.proxy.protocol}
                                                onChange={(e) => updateAppSettings({ proxy: { ...appSettings.proxy, protocol: e.target.value } })}
                                            >
                                                <option value="socks5">SOCKS5</option>
                                                <option value="http">HTTP</option>
                                            </select>
                                        </div>

                                        <div className="flex gap-2">
                                            <div className="space-y-1 flex-1">
                                                <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.proxyHost", "Host")}</label>
                                                <input
                                                    type="text"
                                                    placeholder="127.0.0.1"
                                                    className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow"
                                                    style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                                    value={appSettings.proxy.host}
                                                    onChange={(e) => updateAppSettings({ proxy: { ...appSettings.proxy, host: e.target.value } })}
                                                />
                                            </div>
                                            <div className="space-y-1 w-24">
                                                <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.proxyPort", "Port")}</label>
                                                <input
                                                    type="number"
                                                    min={1} max={65535}
                                                    className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow"
                                                    style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                                    value={appSettings.proxy.port || ""}
                                                    onChange={(e) => updateAppSettings({ proxy: { ...appSettings.proxy, port: parseInt(e.target.value) || 0 } })}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === "search" && (
                                <div className="space-y-6">
                                    <div className="space-y-1">
                                        <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.defaultSearchEngine", "Default Search Engine")}</label>
                                        <p className="text-xs pb-1" style={{ color: "var(--df-text-muted)" }}>{t("settings.defaultSearchEngineDesc", "The primary engine used when double-clicking or right-clicking to search.")}</p>
                                        <select
                                            className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow appearance-none"
                                            style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                            value={appSettings.search.default_engine}
                                            onChange={(e) => updateAppSettings({ search: { ...appSettings.search, default_engine: e.target.value } })}
                                        >
                                            {appSettings.search.custom_engines.map((engine, idx) => (
                                                <option key={idx} value={engine.name}>{engine.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.customEngines", "Search Engines")}</label>
                                            <button
                                                onClick={() => {
                                                    const newEngines = [...appSettings.search.custom_engines, { name: "New Engine", url_template: "https://example.com/search?q=%s" }];
                                                    updateAppSettings({ search: { ...appSettings.search, custom_engines: newEngines } });
                                                }}
                                                className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors"
                                                style={{ backgroundColor: "color-mix(in srgb, var(--df-primary) 10%, transparent)", color: "var(--df-primary)" }}
                                            >
                                                <span className="material-icons text-[14px]">add</span> {t("common.add", "Add")}
                                            </button>
                                        </div>

                                        <div className="border rounded overflow-hidden" style={{ borderColor: "var(--df-border)" }}>
                                            {appSettings.search.custom_engines.map((engine, i) => (
                                                <div key={i} className="flex items-center gap-2 p-2 border-b last:border-0 hover:bg-black/5 dark:hover:bg-white/5 transition-colors" style={{ borderColor: "var(--df-border)" }}>
                                                    <input
                                                        type="text"
                                                        placeholder="Name"
                                                        className="w-1/3 px-2 py-1.5 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow"
                                                        style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                                        value={engine.name}
                                                        onChange={(e) => {
                                                            const newEngines = [...appSettings.search.custom_engines];
                                                            newEngines[i] = { ...newEngines[i], name: e.target.value };
                                                            updateAppSettings({ search: { ...appSettings.search, custom_engines: newEngines } });
                                                        }}
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="URL Template (e.g. https://google.com/search?q=%s)"
                                                        className="flex-1 px-2 py-1.5 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow"
                                                        style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                                        value={engine.url_template}
                                                        onChange={(e) => {
                                                            const newEngines = [...appSettings.search.custom_engines];
                                                            newEngines[i] = { ...newEngines[i], url_template: e.target.value };
                                                            updateAppSettings({ search: { ...appSettings.search, custom_engines: newEngines } });
                                                        }}
                                                    />
                                                    <button
                                                        onClick={() => {
                                                            const newEngines = appSettings.search.custom_engines.filter((_, idx) => idx !== i);
                                                            const newDefault = (appSettings.search.default_engine === engine.name)
                                                                ? (newEngines[0]?.name || "")
                                                                : appSettings.search.default_engine;
                                                            updateAppSettings({ search: { default_engine: newDefault, custom_engines: newEngines } });
                                                        }}
                                                        className="p-1.5 rounded text-red-500 hover:bg-red-500/10 transition-colors"
                                                        title={t("common.delete", "Delete")}
                                                    >
                                                        <span className="material-icons text-[16px]">delete</span>
                                                    </button>
                                                </div>
                                            ))}
                                            {appSettings.search.custom_engines.length === 0 && (
                                                <div className="text-center py-6 text-xs" style={{ color: "var(--df-text-muted)" }}>
                                                    {t("settings.noCustomEngines", "No search engines available.")}
                                                </div>
                                            )}
                                        </div>
                                        <p className="text-xs mt-1" style={{ color: "var(--df-text-muted)" }}>
                                            {t("settings.customEnginesDesc", "Use %s to represent the searched text in the URL template.")}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {activeTab === "translation" && (
                                <div className="space-y-4">
                                    <div className="space-y-1">
                                        <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.translationProvider", "Translation Provider")}</label>
                                        <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.translationProviderDesc", "Select the API provider for translating terminal output.")}</p>
                                        <select
                                            className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow appearance-none"
                                            style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                            value={appSettings.translation.provider}
                                            onChange={(e) => updateAppSettings({ translation: { ...appSettings.translation, provider: e.target.value } })}
                                        >
                                            <option value="">{t("settings.translationDisabled", "Disabled")}</option>
                                            <option value="openai">OpenAI</option>
                                            <option value="deepl">DeepL</option>
                                        </select>
                                    </div>

                                    {appSettings.translation.provider !== "" && (
                                        <div className="space-y-1">
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.translationApiKey", "API Key")}</label>
                                            <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.translationApiKeyDesc", "Enter the API key for your chosen translation provider.")}</p>
                                            <input
                                                type="password"
                                                placeholder="sk-..."
                                                className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow"
                                                style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                                value={appSettings.translation.api_key}
                                                onChange={(e) => updateAppSettings({ translation: { ...appSettings.translation, api_key: e.target.value } })}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeTab === "security" && (
                                <div className="space-y-6">
                                    <div className="space-y-4">
                                        <h4 className="font-semibold text-sm" style={{ color: "var(--df-text)" }}>{t("settings.credentialStorage", "Credential Storage")}</h4>

                                        <div className="flex items-center justify-between">
                                            <div>
                                                <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.useOsKeyring", "Use OS Keyring")}</label>
                                                <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.useOsKeyringDesc", "Securely store SSH passwords and keys in your system's native keychain (Windows Credential Manager, Keychain Access, etc).")}</p>
                                            </div>
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 rounded appearance-none checked:bg-[var(--df-primary)] border checked:border-transparent transition-colors relative after:content-[''] after:absolute after:top-[2px] after:left-[5px] after:w-1.5 after:h-2.5 after:border-r-2 after:border-b-2 after:border-white after:rotate-45 after:hidden checked:after:block"
                                                style={{ borderColor: "var(--df-border)" }}
                                                checked={appSettings.security.use_os_keyring}
                                                onChange={(e) => updateAppSettings({ security: { ...appSettings.security, use_os_keyring: e.target.checked } })}
                                            />
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <div>
                                                <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.requireMasterPassword", "Require Master Password")}</label>
                                                <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.requireMasterPasswordDesc", "Require a master password to encrypt your session database.")}</p>
                                            </div>
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 rounded appearance-none checked:bg-[var(--df-primary)] border checked:border-transparent transition-colors relative after:content-[''] after:absolute after:top-[2px] after:left-[5px] after:w-1.5 after:h-2.5 after:border-r-2 after:border-b-2 after:border-white after:rotate-45 after:hidden checked:after:block"
                                                style={{ borderColor: "var(--df-border)" }}
                                                checked={appSettings.security.require_master_password}
                                                onChange={(e) => updateAppSettings({ security: { ...appSettings.security, require_master_password: e.target.checked } })}
                                            />
                                        </div>
                                    </div>

                                    <div className="border-t pt-4 space-y-4" style={{ borderColor: "var(--df-border)" }}>
                                        <h4 className="font-semibold text-sm" style={{ color: "var(--df-text)" }}>{t("settings.sessionSecurity", "Session Security")}</h4>

                                        <div className="flex items-center justify-between">
                                            <div>
                                                <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.idleLockMinutes", "Session Lock Interval")}</label>
                                                <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>{t("settings.idleLockMinutesDesc", "Lock the application after a specified duration of inactivity (0 to disable).")}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min={0} max={1440}
                                                    className="w-20 px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow"
                                                    style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                                    value={appSettings.security.idle_lock_minutes}
                                                    onChange={(e) => updateAppSettings({ security: { ...appSettings.security, idle_lock_minutes: parseInt(e.target.value) || 0 } })}
                                                />
                                                <span className="text-sm" style={{ color: "var(--df-text-muted)" }}>{t("common.minutes", "mins")}</span>
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="font-medium text-sm" style={{ color: "var(--df-text)" }}>{t("settings.hostKeyPolicy", "Host Key Policy")}</label>
                                            <p className="text-xs pb-1" style={{ color: "var(--df-text-muted)" }}>{t("settings.hostKeyPolicyDesc", "How the application handles unrecognized SSH host keys.")}</p>
                                            <select
                                                className="w-full px-3 py-2 rounded text-sm border focus:outline-none focus:ring-1 transition-shadow appearance-none"
                                                style={{ backgroundColor: "var(--df-bg)", borderColor: "var(--df-border)", color: "var(--df-text)" }}
                                                value={appSettings.security.host_key_policy}
                                                onChange={(e) => updateAppSettings({ security: { ...appSettings.security, host_key_policy: e.target.value } })}
                                            >
                                                <option value="strict">{t("settings.hostKeyStrict", "Strict (Reject unknown hosts)")}</option>
                                                <option value="prompt">{t("settings.hostKeyPrompt", "Prompt (Ask user for confirmation)")}</option>
                                                <option value="accept">{t("settings.hostKeyAccept", "Accept (Automatically add new hosts)")}</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Placeholder for un-implemented tabs */}
                            {activeTab !== "general" && activeTab !== "appearance" && activeTab !== "terminal" && activeTab !== "interaction" && activeTab !== "proxy" && activeTab !== "search" && activeTab !== "translation" && activeTab !== "security" && (
                                <div style={{ color: "var(--df-text-muted)" }}>
                                    Configuration options for <strong>{activeTab}</strong> will be implemented here soon.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
