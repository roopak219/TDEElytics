import pandas as pd

def calculate_trend_weight(df: pd.DataFrame) -> pd.DataFrame:
    """
    Calculates the exponential moving average (Trend Weight).
    """
    if df.empty or 'weight' not in df.columns:
        return df
    
    # Calculate EMA (Exponential Moving Average).
    # Using a span of ~14 days roughly corresponds to alpha=2/(span+1)
    df['trend_weight'] = df['weight'].ewm(span=14, adjust=False).mean()
    return df

def calculate_expenditure(df: pd.DataFrame) -> pd.DataFrame:
    """
    Calculates TDEE based on moving averages of calorie intake and weight trend change.
    Using a 14-day window.
    """
    df['estimated_tdee'] = None
    if len(df) < 14:
        return df
        
    for i in range(13, len(df)):
        window = df.iloc[i-13:i+1]
        
        total_calories = window['calories'].sum()
        
        if pd.isna(window.iloc[-1]['trend_weight']) or pd.isna(window.iloc[0]['trend_weight']):
            continue
            
        weight_diff = window.iloc[-1]['trend_weight'] - window.iloc[0]['trend_weight']
        
        # 1kg body weight roughly translates to 7700 kcal energy balance
        energy_balance = weight_diff * 7700
        
        # If weight went up (positive weight_diff), intake > expenditure -> Expenditure = Intake - Energy Balance
        total_expenditure = total_calories - energy_balance
        daily_tdee = total_expenditure / 14.0
        
        df.loc[df.index[i], 'estimated_tdee'] = daily_tdee
        
    # Smooth the TDEE output slightly so it doesn't jump aggressively day-to-day
    df['estimated_tdee'] = df['estimated_tdee'].ewm(span=7, adjust=False).mean()
    
    return df
