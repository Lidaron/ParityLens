namespace ParityLens.TraceInstrumentation;

using System.Text.Json.Nodes;

/// <summary>Configures value capture for one integration.</summary>
public sealed class ParityTraceCaptureOptions
{
    private readonly List<ValueFormatter> formatters = new();

    /// <summary>Adds a formatter for values assignable to <typeparamref name="T"/>.</summary>
    public ParityTraceCaptureOptions AddFormatter<T>(Func<T, JsonNode?> formatter)
    {
        if (formatter is null)
        {
            throw new ArgumentNullException(nameof(formatter));
        }
        formatters.Add(new ValueFormatter(
            type => typeof(T).IsAssignableFrom(type),
            value => formatter((T)value)));
        return this;
    }

    /// <summary>Adds a formatter selected by runtime value type.</summary>
    public ParityTraceCaptureOptions AddFormatter(
        Func<Type, bool> typePredicate,
        Func<object, JsonNode?> formatter)
    {
        if (typePredicate is null)
        {
            throw new ArgumentNullException(nameof(typePredicate));
        }

        if (formatter is null)
        {
            throw new ArgumentNullException(nameof(formatter));
        }
        formatters.Add(new ValueFormatter(typePredicate, formatter));
        return this;
    }

    internal bool TryFormat(object value, out JsonNode? result)
    {
        Type type = value.GetType();
        foreach (ValueFormatter formatter in formatters)
        {
            if (formatter.TypePredicate(type))
            {
                result = formatter.Formatter(value);
                return true;
            }
        }

        result = null;
        return false;
    }

    private sealed class ValueFormatter
    {
        internal ValueFormatter(Func<Type, bool> typePredicate, Func<object, JsonNode?> formatter)
        {
            TypePredicate = typePredicate;
            Formatter = formatter;
        }

        internal Func<Type, bool> TypePredicate { get; }

        internal Func<object, JsonNode?> Formatter { get; }
    }
}
