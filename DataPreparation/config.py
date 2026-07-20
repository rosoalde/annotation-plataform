import os
MODEL_NAME = "Qwen/Qwen2.5-14B-Instruct-AWQ"
BASE_URL = "http://localhost:8001/v1"
API_KEY = "local-token"

TEMPERATURE = 0
MAX_TOKENS = 3000
MAX_RETRIES = 2
MICRO_BATCH_SIZE = 32

ANALYSIS_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "analysis_db_clean.json")

OUTPUT_SUFFIX = "_reanalizado_schema.csv"

VISION_HABILITADA = False
TOP_K            = 1 

FUNCTION_CALL_MODE = True

MODEL_PARAMS = {
    "temperature": TEMPERATURE,
    "top_k": TOP_K,
    "max_tokens": MAX_TOKENS,
}