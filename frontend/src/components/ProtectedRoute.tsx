import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

export function AdminRoute() {
    const { token, user } = useAuthStore();
    if (!token) return <Navigate to="/login" replace />;
    if (user?.role !== "admin") return <Navigate to="/projects" replace />;
    return <Outlet />;
}

export default function ProtectedRoute() {
    const { token, user } = useAuthStore();
    if (!token) return <Navigate to="/login" replace />;
    if (user?.must_change_password) return <Navigate to="/change-password" replace />;
    return <Outlet />;
}