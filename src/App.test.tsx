import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("App (Version A)", () => {
  it("renders required content", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Sample Home Services — Demo" })).toBeInTheDocument();
    for (const title of ["Small Repairs", "Furniture Assembly", "Home Maintenance"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getAllByText(/Demonstration only — no services offered/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Contact Us" })).toHaveAttribute("type", "submit");
    expect(screen.queryByText(/Weekend Appointments/i)).not.toBeInTheDocument();
  });
});
