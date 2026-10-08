        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, format!("Task error: {e}")))??;
