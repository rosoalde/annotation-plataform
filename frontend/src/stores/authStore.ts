import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthUser } from "../types";

interface AuthState {
    token: string | null;
    user: AuthUser | null;
    currentProjectId: string | null;
    setAuth: (token: string, user: AuthUser) => void;
    setProject: (id: string) => void;
    logout: () => void;
    isAnnotator: () => boolean;
    isReviewer: () => boolean;
    isJudge: () => boolean;
    isAdmin: () => boolean;
    canReview: () => boolean;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            token: null,
            user: null,
            currentProjectId: null,

            setAuth: (token, user) => {
                localStorage.setItem("token", token);
                set({ token, user });
            },
            setProject: (id) => set({ currentProjectId: id }),
            logout: () => {
                localStorage.removeItem("token");
                set({ token: null, user: null, currentProjectId: null });
            },

            isAnnotator: () => get().user?.role === "annotator",
            isReviewer: () => get().user?.role === "reviewer",
            isJudge: () => get().user?.role === "judge",
            isAdmin: () => get().user?.role === "admin",
            canReview: () => ["reviewer", "judge", "admin"].includes(get().user?.role ?? ""),
        }),
        {
            name: "annotation-auth",
            partialize: (state) => ({
                token: state.token,
                user: state.user,
                currentProjectId: state.currentProjectId,
            }),
        }
    )
);