"use client";

import { useState, useRef, useEffect } from "react";

export interface NLResult {
  center: { lat: number; lng: number };
  radiusMiles: number;
  summary: string;
}

interface NLSearchBarProps {
  onResult: (result: NLResult) => void;
  onError: (msg: string) => void;
}

const LS_KEY = "anthropic_api_key";

export default function NLSearchBar({ onResult, onError }: NLSearchBarProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [keyPopoverOpen, setKeyPopoverOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY) ?? "";
    setAnthropicKey(stored);
    setKeyInput(stored);
  }, []);

  function saveKey() {
    const trimmed = keyInput.trim();
    setAnthropicKey(trimmed);
    localStorage.setItem(LS_KEY, trimmed);
    setKeyPopoverOpen(false);
    if (trimmed) inputRef.current?.focus();
  }

  function openKeyPopover() {
    setKeyInput(anthropicKey);
    setKeyPopoverOpen(true);
    setTimeout(() => keyInputRef.current?.focus(), 50);
  }

  async function submit() {
    const trimmed = query.trim();
    if (!trimmed) return;

    if (!anthropicKey) {
      openKeyPopover();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, apiKey: anthropicKey }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to query the database");
      }

      const data = await res.json();
      setQuery("");
      onResult({
        center: data.center,
        radiusMiles: data.radiusMiles,
        summary: data.summary,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(msg);
      onError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  const keyIsSet = !!anthropicKey;

  return (
    <div
      style={{
        position: "absolute",
        top: "48px",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(520px, calc(100vw - 48px))",
        zIndex: 800,
        fontFamily: "var(--font-mono)",
      }}
    >
      {/* Search bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "#111",
          border: "1px solid #444",
          padding: "0 10px",
          gap: "8px",
        }}
      >
        <span style={{ color: "#555", fontSize: "11px", flexShrink: 0 }}>&gt;</span>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="query wells — count, liability, risk, location..."
          disabled={loading}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#e0e0e0",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            padding: "10px 0",
            opacity: loading ? 0.5 : 1,
            letterSpacing: "0.02em",
          }}
        />

        {/* API key button */}
        <button
          onClick={openKeyPopover}
          title={keyIsSet ? "Anthropic API key configured" : "Set Anthropic API key"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px",
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            color: keyIsSet ? "#d4a017" : "#444",
            fontSize: "10px",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.05em",
          }}
          aria-label="Configure Anthropic API key"
        >
          KEY
        </button>

        {/* Spinner or submit */}
        {loading ? (
          <div
            style={{
              width: "10px",
              height: "10px",
              border: "1px solid #333",
              borderTopColor: "#888",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              flexShrink: 0,
            }}
          />
        ) : query.length > 0 ? (
          <button
            onClick={submit}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
              fontSize: "14px",
              fontFamily: "var(--font-mono)",
            }}
            aria-label="Submit query"
          >
            ↵
          </button>
        ) : null}
      </div>

      {/* API key popover */}
      {keyPopoverOpen && (
        <div
          style={{
            marginTop: "1px",
            background: "#111",
            border: "1px solid #444",
            padding: "12px",
          }}
        >
          <p
            style={{
              margin: "0 0 8px",
              fontSize: "10px",
              color: "#666",
              lineHeight: 1.6,
              letterSpacing: "0.03em",
            }}
          >
            ANTHROPIC API KEY — stored locally in your browser only
          </p>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              ref={keyInputRef}
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveKey();
                if (e.key === "Escape") setKeyPopoverOpen(false);
              }}
              placeholder="sk-ant-..."
              style={{
                flex: 1,
                background: "#0a0a0a",
                border: "1px solid #333",
                color: "#e0e0e0",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                padding: "6px 8px",
                outline: "none",
              }}
            />
            <button
              onClick={saveKey}
              style={{
                background: "none",
                border: "1px solid #888",
                color: "#e0e0e0",
                cursor: "pointer",
                fontSize: "10px",
                padding: "6px 12px",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.08em",
              }}
            >
              SAVE
            </button>
            <button
              onClick={() => setKeyPopoverOpen(false)}
              style={{
                background: "none",
                border: "1px solid #333",
                color: "#555",
                cursor: "pointer",
                fontSize: "10px",
                padding: "6px 10px",
                fontFamily: "var(--font-mono)",
              }}
            >
              ×
            </button>
          </div>
          {anthropicKey && (
            <button
              onClick={() => {
                setAnthropicKey("");
                setKeyInput("");
                localStorage.removeItem(LS_KEY);
                setKeyPopoverOpen(false);
              }}
              style={{
                marginTop: "8px",
                background: "none",
                border: "none",
                color: "#444",
                cursor: "pointer",
                fontSize: "10px",
                padding: 0,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.06em",
              }}
            >
              CLEAR SAVED KEY
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            marginTop: "1px",
            fontSize: "10px",
            color: "#e5484d",
            background: "#111",
            border: "1px solid #333",
            borderLeft: "2px solid #e5484d",
            padding: "8px 12px",
            letterSpacing: "0.03em",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
