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
    <div className="w-full font-mono flex flex-col mt-1">
      {/* Search bar */}
      <div className="flex items-center bg-zinc-900 border border-zinc-800 px-3 py-1.5 gap-2 rounded-sm">
        <span className="text-zinc-600 text-xs flex-shrink-0">&gt;</span>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="AI natural language search..."
          disabled={loading}
          className="flex-1 bg-transparent border-none outline-none text-zinc-200 text-xs font-mono py-1 opacity-100 disabled:opacity-50 tracking-wide"
        />

        {/* API key button */}
        <button
          onClick={openKeyPopover}
          title={keyIsSet ? "Anthropic API key configured" : "Set Anthropic API key"}
          className={`bg-none border-none cursor-pointer p-0.5 flex items-center flex-shrink-0 text-[10px] font-mono tracking-widest ${
            keyIsSet ? "text-amber-500" : "text-zinc-600"
          }`}
          aria-label="Configure Anthropic API key"
        >
          KEY
        </button>

        {/* Spinner or submit */}
        {loading ? (
          <div className="w-2.5 h-2.5 border border-zinc-800 border-t-zinc-400 rounded-full animate-spin flex-shrink-0" />
        ) : query.length > 0 ? (
          <button
            onClick={submit}
            className="bg-none border-none text-zinc-400 cursor-pointer p-0.5 flex items-center flex-shrink-0 text-sm font-mono"
            aria-label="Submit query"
          >
            ↵
          </button>
        ) : null}
      </div>

      {/* API key popover */}
      {keyPopoverOpen && (
        <div className="mt-1 bg-zinc-900 border border-zinc-800 p-3 flex flex-col rounded-sm">
          <p className="margin-0 mb-2 text-[9px] text-zinc-500 leading-normal tracking-wide">
            ANTHROPIC API KEY — stored locally in your browser only
          </p>
          <div className="flex gap-2">
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
              className="flex-1 bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono px-2 py-1 outline-none rounded-sm"
            />
            <button
              onClick={saveKey}
              className="bg-none border border-zinc-700 hover:border-zinc-500 text-zinc-200 cursor-pointer text-[10px] px-3 py-1 font-mono tracking-wider rounded-sm"
            >
              SAVE
            </button>
            <button
              onClick={() => setKeyPopoverOpen(false)}
              className="bg-none border border-zinc-800 text-zinc-505 cursor-pointer text-[10px] px-2 py-1 font-mono rounded-sm"
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
              className="mt-2 bg-none border-none text-zinc-500 hover:text-zinc-400 cursor-pointer text-[10px] p-0 font-mono tracking-wide self-start"
            >
              CLEAR SAVED KEY
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-1 text-[10px] text-red-400 bg-zinc-950 border border-zinc-800 border-l-2 border-l-red-500 p-2.5 rounded-sm tracking-wide">
          {error}
        </div>
      )}
    </div>
  );
}
