//! Proc macros for SDK-neutral Parity Lens tracing.

use proc_macro::TokenStream;
use quote::quote;
use syn::parse::Parser;
use syn::punctuated::Punctuated;
use syn::{
    Attribute, Field, Fields, FnArg, ImplItem, ImplItemFn, ItemEnum, ItemImpl, ItemStruct, LitStr,
    Pat, Token, parse_macro_input, parse_quote,
};

#[proc_macro_attribute]
pub fn trace_enum(arguments: TokenStream, item: TokenStream) -> TokenStream {
    if !arguments.is_empty() {
        return syn::Error::new(proc_macro2::Span::call_site(), "trace_enum does not accept arguments")
            .to_compile_error()
            .into();
    }

    let enumeration = parse_macro_input!(item as ItemEnum);
    if let Some(variant) = enumeration
        .variants
        .iter()
        .find(|variant| !matches!(variant.fields, Fields::Unit))
    {
        return syn::Error::new_spanned(variant, "trace_enum supports only fieldless enum variants")
            .to_compile_error()
            .into();
    }

    let enum_identifier = &enumeration.ident;
    let variants = enumeration.variants.iter().map(|variant| &variant.ident).collect::<Vec<_>>();
    let names = variants.iter().map(|variant| quote! { Self::#variant => stringify!(#variant) });
    let values = variants.iter().map(|variant| quote! { Self::#variant => Self::#variant as i64 });
    let members = variants.iter().map(|variant| {
        quote! {
            serde_json::json!({
                "symbol": concat!(module_path!(), "::", stringify!(#enum_identifier), "::", stringify!(#variant)),
                "name": stringify!(#variant),
                "value": Self::#variant as i64,
            })
        }
    });

    quote! {
        #enumeration

        impl serde::Serialize for #enum_identifier {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: serde::Serializer,
            {
                let enum_name = match self { #(#names),* };
                let enum_value = match self { #(#values),* };
                let members = [#(#members),*];
                let mut state = serde::Serializer::serialize_struct(serializer, stringify!(#enum_identifier), 8)?;
                serde::ser::SerializeStruct::serialize_field(&mut state, "enum_id", &Option::<&str>::None)?;
                serde::ser::SerializeStruct::serialize_field(
                    &mut state,
                    "enum_symbol",
                    concat!(module_path!(), "::", stringify!(#enum_identifier)),
                )?;
                serde::ser::SerializeStruct::serialize_field(&mut state, "enum_type", stringify!(#enum_identifier))?;
                serde::ser::SerializeStruct::serialize_field(&mut state, "enum_name", enum_name)?;
                serde::ser::SerializeStruct::serialize_field(&mut state, "enum_value", &enum_value)?;
                serde::ser::SerializeStruct::serialize_field(&mut state, "enum_names", &[enum_name])?;
                serde::ser::SerializeStruct::serialize_field(&mut state, "enum_members", &members)?;
                serde::ser::SerializeStruct::serialize_field(&mut state, "enum_flags", &false)?;
                serde::ser::SerializeStruct::end(state)
            }
        }
    }
    .into()
}

#[derive(Default)]
struct FieldPolicy {
    nested: bool,
    skip: bool,
    redact: bool,
    serializer: Option<LitStr>,
}

fn take_field_policy(attributes: &mut Vec<Attribute>) -> syn::Result<FieldPolicy> {
    let mut policy = FieldPolicy::default();
    let mut retained = Vec::with_capacity(attributes.len());
    for attribute in std::mem::take(attributes) {
        if !attribute.path().is_ident("parity_trace") {
            retained.push(attribute);
            continue;
        }
        attribute.parse_nested_meta(|meta| {
            if meta.path.is_ident("nested") {
                policy.nested = true;
            } else if meta.path.is_ident("skip") {
                policy.skip = true;
            } else if meta.path.is_ident("redact") {
                policy.redact = true;
            } else if meta.path.is_ident("with") {
                policy.serializer = Some(meta.value()?.parse()?);
            } else {
                return Err(meta.error("expected nested, skip, redact, or with = \"path\""));
            }
            Ok(())
        })?;
    }
    *attributes = retained;
    Ok(policy)
}

fn add_standard_adapter(field: &mut Field, policy: &FieldPolicy) {
    if policy.skip {
        field.attrs.push(parse_quote!(#[serde(skip)]));
        return;
    }
    if policy.redact {
        field.attrs.push(parse_quote!(#[serde(serialize_with = "::parity_lens_trace::serialize_redacted")]));
        return;
    }
    if let Some(serializer) = &policy.serializer {
        field.attrs.push(parse_quote!(#[serde(serialize_with = #serializer)]));
        return;
    }

    let field_type = &field.ty;
    let type_name = quote!(#field_type).to_string().replace(' ', "");
    let serializer = if type_name.ends_with("SystemTime") {
        Some("::parity_lens_trace::serialize_system_time")
    } else if type_name.ends_with("Duration") {
        Some("::parity_lens_trace::serialize_duration")
    } else if type_name.ends_with("HeaderMap") {
        Some("::parity_lens_trace::serialize_headers")
    } else if type_name.ends_with("Method") {
        Some("::parity_lens_trace::serialize_method")
    } else if type_name.ends_with("StatusCode") {
        Some("::parity_lens_trace::serialize_status")
    } else if type_name.ends_with("Version") {
        Some("::parity_lens_trace::serialize_version")
    } else if type_name == "Option<bytes::Bytes>" {
        Some("::parity_lens_trace::serialize_optional_body")
    } else if type_name == "Vec<u8>" && field.ident.as_ref().is_some_and(|name| name == "body") {
        Some("::parity_lens_trace::serialize_body")
    } else {
        None
    };
    if let Some(serializer) = serializer {
        let serializer = LitStr::new(serializer, proc_macro2::Span::call_site());
        field.attrs.push(parse_quote!(#[serde(serialize_with = #serializer)]));
    }
}

#[proc_macro_attribute]
pub fn trace_data(arguments: TokenStream, item: TokenStream) -> TokenStream {
    if !arguments.is_empty() {
        return syn::Error::new(proc_macro2::Span::call_site(), "trace_data does not accept arguments")
            .to_compile_error()
            .into();
    }

    let mut structure = parse_macro_input!(item as ItemStruct);
    let structure_identifier = &structure.ident;
    let generics = structure.generics.clone();
    let (impl_generics, type_generics, where_clause) = generics.split_for_impl();
    let mut direct_fields = Vec::new();
    let mut nested_fields = Vec::new();

    let fields = match &mut structure.fields {
        Fields::Named(fields) => &mut fields.named,
        Fields::Unnamed(fields) => &mut fields.unnamed,
        Fields::Unit => {
            structure.attrs.push(parse_quote!(#[derive(serde::Serialize)]));
            return quote! {
                #structure
                impl #impl_generics ::parity_lens_trace::TraceDataSymbols
                    for #structure_identifier #type_generics #where_clause
                {
                    fn trace_field_symbols(
                        _direction: &'static str,
                        _root_path: &str,
                    ) -> Vec<::parity_lens_trace::TraceFieldSymbol> {
                        Vec::new()
                    }
                }
            }.into();
        }
    };

    for field in fields {
        let policy = match take_field_policy(&mut field.attrs) {
            Ok(policy) => policy,
            Err(error) => return error.to_compile_error().into(),
        };
        let Some(field_identifier) = field.ident.as_ref() else {
            add_standard_adapter(field, &policy);
            continue;
        };
        let field_type = &field.ty;
        direct_fields.push(quote! {
            ::parity_lens_trace::TraceFieldSymbol {
                direction,
                path: format!("{}[\"{}\"]", root_path, stringify!(#field_identifier)),
                serialized_path: format!("{}[\"{}\"]", root_path, stringify!(#field_identifier)),
                owner_type_symbol: std::any::type_name::<Self>(),
                value_type_symbol: std::any::type_name::<#field_type>(),
            }
        });
        if policy.nested {
            nested_fields.push(quote! {
                fields.extend(<#field_type as ::parity_lens_trace::TraceDataSymbols>::trace_field_symbols(
                    direction,
                    &format!("{}[\"{}\"]", root_path, stringify!(#field_identifier)),
                ));
            });
        }
        add_standard_adapter(field, &policy);
    }
    structure.attrs.push(parse_quote!(#[derive(serde::Serialize)]));

    quote! {
        #structure

        impl #impl_generics ::parity_lens_trace::TraceDataSymbols
            for #structure_identifier #type_generics #where_clause
        {
            fn trace_field_symbols(
                direction: &'static str,
                root_path: &str,
            ) -> Vec<::parity_lens_trace::TraceFieldSymbol> {
                let mut fields = vec![#(#direct_fields),*];
                #(#nested_fields)*
                fields
            }
        }
    }
    .into()
}

fn add_serialize_bounds(function: &mut ImplItemFn) {
    for type_parameter in function.sig.generics.type_params_mut() {
        type_parameter.bounds.push(parse_quote!(serde::Serialize));
    }
}

#[proc_macro_attribute]
pub fn trace_serializable(_arguments: TokenStream, item: TokenStream) -> TokenStream {
    let function = parse_macro_input!(item as ImplItemFn);
    let mut traced_function = function.clone();
    add_serialize_bounds(&mut traced_function);
    quote! {
        #[cfg(test)]
        #function
        #[cfg(not(test))]
        #traced_function
    }
    .into()
}

#[proc_macro_attribute]
pub fn trace_serializable_impl(_arguments: TokenStream, item: TokenStream) -> TokenStream {
    let implementation = parse_macro_input!(item as ItemImpl);
    let mut traced_implementation = implementation.clone();
    for item in &mut traced_implementation.items {
        if let ImplItem::Fn(function) = item {
            add_serialize_bounds(function);
        }
    }
    quote! {
        #[cfg(test)]
        #implementation
        #[cfg(not(test))]
        #traced_implementation
    }
    .into()
}

#[proc_macro_attribute]
pub fn trace_function(arguments: TokenStream, item: TokenStream) -> TokenStream {
    let parser = Punctuated::<LitStr, Token![,]>::parse_terminated;
    let arguments = match parser.parse(arguments) {
        Ok(arguments) if !arguments.is_empty() => arguments,
        _ => {
            return syn::Error::new(
                proc_macro2::Span::call_site(),
                "expected a step ID followed by zero or more input parameter names",
            )
            .to_compile_error()
            .into();
        }
    };
    let function = parse_macro_input!(item as ImplItemFn);
    let mut traced_function = function.clone();
    add_serialize_bounds(&mut traced_function);
    let function_identifier = traced_function.sig.ident.clone();
    let mut values = arguments.into_iter();
    let step_id = values.next().expect("validated argument count");
    let input_names = values.collect::<Vec<_>>();
    let input_identifiers = input_names
        .iter()
        .map(|name| syn::Ident::new(&name.value(), name.span()))
        .collect::<Vec<_>>();
    let input_capture_expressions = input_identifiers.iter().map(|identifier| {
        let parameter_type = traced_function.sig.inputs.iter().find_map(|argument| match argument {
            FnArg::Typed(parameter) => match parameter.pat.as_ref() {
                Pat::Ident(pattern) if pattern.ident == *identifier => Some(parameter.ty.as_ref()),
                _ => None,
            },
            FnArg::Receiver(_) => None,
        });
        let is_reference = matches!(parameter_type, Some(syn::Type::Reference(_)));
        let is_http_method = parameter_type.is_some_and(|parameter_type| {
            quote!(#parameter_type)
                .to_string()
                .replace(' ', "")
                .trim_start_matches('&')
                .ends_with("http::Method")
        });
        if is_http_method && is_reference {
            quote! { ::parity_lens_trace::capture_http_method(#identifier) }
        } else if is_http_method {
            quote! { ::parity_lens_trace::capture_http_method(&#identifier) }
        } else if is_reference {
            quote! { ::parity_lens_trace::capture_value(#identifier) }
        } else {
            quote! { ::parity_lens_trace::capture_value(&#identifier) }
        }
    }).collect::<Vec<_>>();
    let input_symbols = input_identifiers
        .iter()
        .zip(input_names.iter())
        .filter_map(|(identifier, name)| {
            traced_function.sig.inputs.iter().find_map(|argument| match argument {
                FnArg::Typed(parameter) => match parameter.pat.as_ref() {
                    Pat::Ident(pattern) if pattern.ident == *identifier => {
                        let parameter_type = parameter.ty.as_ref();
                        Some(quote! {
                            ::parity_lens_trace::TraceParameterSymbol {
                                name: #name,
                                type_symbol: std::any::type_name::<#parameter_type>(),
                                path: concat!("$[\"", #name, "\"]"),
                            }
                        })
                    }
                    _ => None,
                },
                FnArg::Receiver(_) => None,
            })
        })
        .collect::<Vec<_>>();
    let original_block = traced_function.block.clone();
    let function_name = quote! { concat!(module_path!(), "::", stringify!(#function_identifier)) };
    traced_function.block = if traced_function.sig.asyncness.is_some() {
        parse_quote!({
            if ::parity_lens_trace::is_enabled() {
                let __parity_trace_input = ::parity_lens_trace::capture_inputs(&[
                    #((#input_names, #input_capture_expressions)),*
                ]);
                ::parity_lens_trace::trace_future(
                    #step_id,
                    #function_name,
                    ::parity_lens_trace::FunctionTraceSymbols {
                        function_symbol: #function_name,
                        parameters: vec![#(#input_symbols),*],
                        output_type_symbol: "",
                        fields: Vec::new(),
                    },
                    __parity_trace_input,
                    Box::pin(async move #original_block),
                ).await
            } else {
                #original_block
            }
        })
    } else {
        parse_quote!({
            let __parity_trace_input = ::parity_lens_trace::capture_inputs(&[
                #((#input_names, #input_capture_expressions)),*
            ]);
            ::parity_lens_trace::trace_future(
                #step_id,
                #function_name,
                ::parity_lens_trace::FunctionTraceSymbols {
                    function_symbol: #function_name,
                    parameters: vec![#(#input_symbols),*],
                    output_type_symbol: "",
                    fields: Vec::new(),
                },
                __parity_trace_input,
                Box::pin((|| #original_block)()),
            )
        })
    };

    quote! {
        #[cfg(test)]
        #function
        #[cfg(not(test))]
        #traced_function
    }
    .into()
}
