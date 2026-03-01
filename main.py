from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import pandas as pd
import os
from datetime import datetime

# Import algorithms
from algorithms import calculate_trend_weight, calculate_expenditure

import json

app = FastAPI(title="TDEElytics API")

# Define absolute paths explicitly for deployment stability (e.g. PythonAnywhere)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data.csv")
USERS_FILE = os.path.join(BASE_DIR, "users.json")

# Ensure static directory exists for when we mount
os.makedirs(os.path.join(BASE_DIR, "static"), exist_ok=True)

class LogEntry(BaseModel):
    user: str
    pin: str
    goal: str = "maintain"  # lose_0_5, lose_0_25, maintain, gain_0_25, gain_0_5
    date: str
    weight: float
    calories: int
    protein: int = 0
    carbs: int = 0
    fats: int = 0

def authenticate(user: str, pin: str):
    if not os.path.exists(USERS_FILE):
        return True
    with open(USERS_FILE, 'r') as f:
        users = json.load(f)
    # If user doesn't exist, create them with this PIN automatically
    if user not in users:
        users[user] = pin
        with open(USERS_FILE, 'w') as f:
            json.dump(users, f, indent=4)
        return True
    # If user exists, check pin
    if users[user] != pin:
        raise HTTPException(status_code=401, detail="Invalid PIN")
    return True

@app.get("/api/data")
def get_data(user: str = "default", pin: str = "0000", goal: str = "maintain"):
    """
    Reads the CSV, applying algorithms for the specific user and returning targets.
    """
    authenticate(user, pin)
    
    if not os.path.exists(DATA_FILE):
        return {"data": []}
    
    try:
        df = pd.read_csv(DATA_FILE)
        # Filter dataset by user
        if 'user' in df.columns:
            df = df[df['user'] == user].copy()
        
        if df.empty:
            return {"data": []}
            
        # Sort by date
        df['date'] = pd.to_datetime(df['date'])
        df = df.sort_values(by='date')
        
        # Apply Algorithms
        df = calculate_trend_weight(df)
        df = calculate_expenditure(df)
        
        # Calculate Target Calories based on Goal
        # ~7700 kcal / 1kg. So losing 0.5kg/week = 3850 kcal deficit/week = -550 kcal/day
        goal_modifiers = {
            "lose_1_0": -1100,
            "lose_0_5": -550,
            "lose_0_25": -275,
            "maintain": 0,
            "gain_0_25": 275,
            "gain_0_5": 550
        }
        modifier = goal_modifiers.get(goal, 0)
        df['target_calories'] = df['estimated_tdee'] + modifier
        df.loc[df['target_calories'].notnull(), 'target_calories'] = df['target_calories'].round()
        
        # Convert date back to string for JSON serialization
        df['date'] = df['date'].dt.strftime('%Y-%m-%d')
        
        # Convert to dictionary
        records = df.to_dict(orient="records")
        
        # Clean up records for JSON (convert NaNs to None and numpy types to native python types)
        import math
        cleaned_records = []
        for record in records:
            clean_record = {}
            for k, v in record.items():
                if v is None:
                    clean_record[k] = None
                elif isinstance(v, float) and math.isnan(v):
                    clean_record[k] = None
                else:
                    clean_record[k] = v
            cleaned_records.append(clean_record)
            
        return {"data": cleaned_records}
        
    except Exception as e:
        import traceback
        traceback.print_exc() # Print full error to console for debugging
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/log")
def add_log(entry: LogEntry):
    """
    Appends a new daily log to the CSV file for the user.
    """
    authenticate(entry.user, entry.pin)
    try:
        # Convert to dictionary and format date if needed
        new_row = entry.model_dump()
        
        # Enforce 3-day max backdated limit and no future dates
        entry_date = datetime.strptime(new_row['date'], '%Y-%m-%d').date()
        today = datetime.now().date()
        diff = (today - entry_date).days
        
        if diff < 0:
            raise HTTPException(status_code=400, detail="Cannot log future dates.")
        if diff > 3:
            raise HTTPException(status_code=400, detail="Cannot log dates older than 3 days.")
        
        # Remove pin and goal from the saved data (we just needed it for auth/targets)
        del new_row['pin']
        del new_row['goal']
        
        # Check if file exists to write header or not
        file_exists = os.path.exists(DATA_FILE)
        
        # Create a single row DataFrame
        df_new = pd.DataFrame([new_row])
        
        # If the file exists and has data, check if we're overwriting a date for this user
        if file_exists:
            try:
                df_existing = pd.read_csv(DATA_FILE)
                # If date AND user exists, replace that row
                mask = (df_existing['date'] == new_row['date']) & (df_existing['user'] == new_row['user'])
                if mask.any():
                    df_existing.loc[mask, list(new_row.keys())] = list(new_row.values())
                    df_existing.to_csv(DATA_FILE, index=False)
                else:
                    df_new.to_csv(DATA_FILE, mode='a', header=False, index=False)
            except pd.errors.EmptyDataError:
                # File exists but is empty
                df_new.to_csv(DATA_FILE, mode='w', header=True, index=False)
        else:
            df_new.to_csv(DATA_FILE, mode='w', header=True, index=False)
            
        return {"status": "success", "message": "Log saved successfully."}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/reset")
def reset_user(user: str, pin: str):
    """
    Deletes all rows for a specific user.
    """
    authenticate(user, pin)
    if not os.path.exists(DATA_FILE):
        return {"status": "success"}
    
    try:
        df = pd.read_csv(DATA_FILE)
        df = df[df['user'] != user]
        df.to_csv(DATA_FILE, index=False)
        return {"status": "success", "message": "Data wiped for user."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount the static site for the frontend.
# It's important to mount this last so it doesn't intercept API routes.
app.mount("/", StaticFiles(directory=os.path.join(BASE_DIR, "static"), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
