import React, { useState } from "react";
import { authApi } from "../services/api";
import { useAuthStore } from "../stores/authStore";

export default function ChangePasswordView() {
    const { user, setAuth, token } = useAuthStore();
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        if (newPassword !== confirmPassword) {
            setError("Las contraseñas nuevas no coinciden");
            return;
        }
        if (newPassword.length < 8) {
            setError("La nueva contraseña debe tener al menos 8 caracteres");
            return;
        }
        setLoading(true);
        try {
            await authApi.changePassword(currentPassword, newPassword);
            if (user && token) {
                setAuth(token, { ...user, must_change_password: false });
            }
            window.location.href = "/projects";
        } catch (err: any) {
            setError(err?.response?.data?.detail ?? "Error al cambiar la contraseña");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={styles.bg}>
            <div style={styles.card}>
                <div style={styles.brand}>Panel de etiquetado</div>
                <h1 style={styles.heading}>Cambiá tu contraseña</h1>
                <div style={styles.notice}>
                    ⚠ Tu contraseña fue reseteada por un administrador. Debés establecer una nueva antes de continuar.
                </div>
                <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <label style={styles.label}>Contraseña temporal</label>
                    <input style={styles.input} type="password" value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)} required />

                    <label style={styles.label}>Nueva contraseña</label>
                    <input style={styles.input} type="password" value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="mínimo 8 caracteres" required />

                    <label style={styles.label}>Confirmar nueva contraseña</label>
                    <input style={styles.input} type="password" value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)} required />

                    {error && <div style={styles.error}>{error}</div>}

                    <button type="submit" style={styles.submit} disabled={loading}>
                        {loading ? "..." : "Guardar y continuar →"}
                    </button>
                </form>
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    bg: { minHeight: "100vh", background: "#0a0b0e", display: "flex", alignItems: "center", justifyContent: "center" },
    card: { background: "#181b22", border: "1px solid #252830", borderRadius: 12, padding: 32, width: 380 },
    brand: { fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b7080", marginBottom: 6, fontFamily: "monospace" },
    heading: { fontSize: 22, fontWeight: 600, color: "#dde1ec", marginBottom: 16 },
    notice: { fontSize: 12, color: "#e8962a", background: "rgba(232,150,42,0.1)", border: "1px solid rgba(232,150,42,0.3)", borderRadius: 8, padding: "10px 12px", marginBottom: 18, lineHeight: 1.5 },
    label: { fontSize: 11, color: "#6b7080", fontWeight: 500 },
    input: { background: "#111318", border: "1px solid #252830", borderRadius: 8, color: "#dde1ec", padding: "8px 11px", fontSize: 13, outline: "none", fontFamily: "inherit" },
    error: { fontSize: 12, color: "#e05252", background: "rgba(224,82,82,0.1)", borderRadius: 6, padding: "7px 10px" },
    submit: { marginTop: 4, background: "#4e7bef", color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 500, cursor: "pointer" },
};