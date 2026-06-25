import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

export default function ProtectedRoute() {
    const token = useAuthStore((s) => s.token);
    return token ? <Outlet /> : <Navigate to="/login" replace />;
}

export function AdminRoute() {
    const { token, user } = useAuthStore();
    if (!token) return <Navigate to="/login" replace />;
    if (user?.role !== "admin") return <Navigate to="/projects" replace />;
    return <Outlet />;
}