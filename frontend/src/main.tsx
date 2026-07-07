import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import LoginView from "./views/LoginView";
import ProjectsView from "./views/ProjectsView";
// import SentimentView from "./views/SentimentView";
// import PilarsView from "./views/PilarsView";
import AnnotateView from "./views/AnnotateView";
import ReviewView from "./views/ReviewView";
import JudgeView from "./views/JudgeView";
import KeywordsView from "./views/KeywordsView";
import AdminView from "./views/AdminView";
import Layout from "./components/Layout";
import ProtectedRoute, { AdminRoute } from "./components/ProtectedRoute";
import ChangePasswordView from "./views/ChangePasswordView";
import ImportView from "./views/ImportView";

import "./index.css";

const qc = new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <QueryClientProvider client={qc}>
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<LoginView />} />
                    <Route element={<ProtectedRoute />}>
                        <Route path="/change-password" element={<ChangePasswordView />} />
                        <Route element={<Layout />}>
                            <Route index element={<Navigate to="/projects" replace />} />
                            <Route path="/projects" element={<ProjectsView />} />
                            <Route path="/projects/:id/keywords" element={<KeywordsView />} />
                            {/* <Route path="/projects/:id/sentiment" element={<SentimentView />} />
                            <Route path="/projects/:id/pilars" element={<PilarsView />} /> */}
                            <Route path="/projects/:id/anotar" element={<AnnotateView />} />
                            <Route path="/projects/:id/review" element={<ReviewView />} />
                            <Route path="/projects/:id/judge" element={<JudgeView />} />
                            <Route path="/projects/:id/import" element={<ImportView />} />
                            <Route element={<AdminRoute />}>
                                <Route path="/admin" element={<AdminView />} />
                            </Route>
                        </Route>

                    </Route>
                    <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
            </BrowserRouter>
        </QueryClientProvider>
    </React.StrictMode>
);