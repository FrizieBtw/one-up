"use client";

import { Component, type ReactNode } from "react";

/** Décor 3D facultatif : si un modèle ne se charge pas, la scène continue sans lui au lieu de planter la page. */
export class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
